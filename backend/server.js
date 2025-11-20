const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const dbPath = path.join(__dirname, 'database.sqlite');

if (fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory()) {
  console.log('Removing database.sqlite directory (should be a file)...');
  fs.rmSync(dbPath, { recursive: true, force: true });
}

if (process.env.FRESH_DATABASE === 'true' && fs.existsSync(dbPath) && fs.statSync(dbPath).isFile()) {
  console.log('Fresh database requested - removing existing database file...');
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.on('error', (err) => {
  console.error('Database error:', err.message);
  process.exit(1);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT UNIQUE NOT NULL,
    name TEXT,
    currency TEXT,
    policy TEXT,
    profile_picture TEXT,
    submission_state TEXT,
    triage_active TEXT,
    state TEXT,
    started_accepting_at TEXT,
    number_of_reports_for_user INTEGER,
    number_of_valid_reports_for_user INTEGER,
    bounty_earned_for_user REAL,
    last_invitation_accepted_at_for_user TEXT,
    bookmarked INTEGER,
    allows_bounty_splitting INTEGER,
    offers_bounties INTEGER,
    open_scope INTEGER,
    fast_payments INTEGER,
    gold_standard_safe_harbor INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS api_config (
    id INTEGER PRIMARY KEY,
    username TEXT,
    token TEXT,
    last_used DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS scope_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_handle TEXT NOT NULL,
    target_type TEXT,
    target TEXT,
    eligible_for_bounty INTEGER,
    eligible_for_submission INTEGER,
    instruction TEXT,
    severity_rating TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (program_handle) REFERENCES programs(handle) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS scope_target_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_target_id INTEGER NOT NULL,
    status_code INTEGER,
    has_auth_indicators INTEGER,
    test_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scope_target_id) REFERENCES scope_targets(id) ON DELETE CASCADE
  )`);
});

let wss = null;
let currentScanProgress = { current: 0, total: 0, status: 'idle', message: '' };

// Function to test a URL scope target
async function testUrlTarget(scopeTargetId, url, programHandle) {
  try {
    // Normalize URL - add https:// if no protocol
    let testUrl = url.trim();
    if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
      testUrl = 'https://' + testUrl;
    }

    console.log(`[TEST] Testing URL: ${testUrl}`);
    
    const response = await axios.get(testUrl, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true, // Accept any status code
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const statusCode = response.status;
    const html = response.data || '';
    const htmlLower = html.toLowerCase();

    // Check for authentication indicators
    const authIndicators = [
      'login',
      'sign in',
      'sign-in',
      'log in',
      'log-in',
      'authenticate',
      'password',
      'username',
      'email',
      'forgot password',
      'forgot-password',
      'reset password',
      'reset-password',
      'create account',
      'create-account',
      'register',
      'sign up',
      'sign-up'
    ];

    let hasAuthIndicators = false;
    for (const indicator of authIndicators) {
      if (htmlLower.includes(indicator)) {
        // Check if it's in common auth-related contexts
        const patterns = [
          new RegExp(`<[^>]*${indicator}[^>]*>`, 'i'),
          new RegExp(`"${indicator}"`, 'i'),
          new RegExp(`'${indicator}'`, 'i'),
          new RegExp(`\\b${indicator}\\b`, 'i')
        ];
        
        for (const pattern of patterns) {
          if (pattern.test(html)) {
            hasAuthIndicators = true;
            break;
          }
        }
        if (hasAuthIndicators) break;
      }
    }

    // Save test results
    db.run(
      `INSERT INTO scope_target_tests (scope_target_id, status_code, has_auth_indicators) VALUES (?, ?, ?)`,
      [scopeTargetId, statusCode, hasAuthIndicators ? 1 : 0],
      (err) => {
        if (err) {
          console.error(`[TEST] Error saving test results for ${testUrl}:`, err);
        } else {
          console.log(`[TEST] Saved test results for ${testUrl}: status=${statusCode}, auth=${hasAuthIndicators}`);
        }
      }
    );

  } catch (error) {
    console.error(`[TEST] Error testing URL ${url}:`, error.message);
    // Save error as test result with null values
    db.run(
      `INSERT INTO scope_target_tests (scope_target_id, status_code, has_auth_indicators) VALUES (?, ?, ?)`,
      [scopeTargetId, null, 0],
      (err) => {
        if (err) {
          console.error(`[TEST] Error saving error result for ${url}:`, err);
        }
      }
    );
  }
}

function broadcastProgress(progress) {
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'progress', data: progress }));
      }
    });
  }
}

app.post('/api/test-credentials', async (req, res) => {
  const { username, token } = req.body;

  console.log('[TEST] Testing credentials for user:', username);

  if (!username || !token) {
    console.log('[TEST] Error: Username and token are required');
    return res.status(400).json({ error: 'Username and token are required' });
  }

  try {
    console.log('[TEST] Making API request to HackerOne...');
    const response = await axios.get('https://api.hackerone.com/v1/hackers/programs', {
      auth: {
        username: username,
        password: token
      },
      headers: {
        'Accept': 'application/json'
      },
      params: {
        'page[size]': 1
      }
    });

    console.log('[TEST] API request successful, status:', response.status);
    db.run(
      'INSERT OR REPLACE INTO api_config (id, username, token, last_used) VALUES (1, ?, ?, datetime("now"))',
      [username, token]
    );

    console.log('[TEST] Credentials saved to database');
    res.json({ success: true, message: 'Credentials are valid' });
  } catch (error) {
    console.log('[TEST] Credential test failed:', error.message);
    if (error.response) {
      console.log('[TEST] Response status:', error.response.status);
      console.log('[TEST] Response data:', error.response.data);
    }
    res.status(401).json({ error: 'Invalid credentials', details: error.message });
  }
});

app.post('/api/scan', async (req, res) => {
  const { username, token, limit, scopeLimit, requireSubmission, requireBounties, requireOpenScope, requireSafeHarbor } = req.body;

  console.log('[SCAN] Scan request received');
  if (limit) {
    console.log(`[SCAN] Program limit set to: ${limit}`);
  }
  if (scopeLimit) {
    console.log(`[SCAN] Scope target limit set to: ${scopeLimit}`);
  }
  console.log(`[SCAN] Requirements: Submission=${requireSubmission}, Bounties=${requireBounties}, OpenScope=${requireOpenScope}, SafeHarbor=${requireSafeHarbor}`);
  
  if (!username || !token) {
    console.log('[SCAN] Error: Username and token are required');
    return res.status(400).json({ error: 'Username and token are required' });
  }

  console.log('[SCAN] Fetching programs from HackerOne API...');
  
  currentScanProgress = { current: 0, total: 0, status: 'scanning', message: 'Fetching List of Public Programs' };
  broadcastProgress(currentScanProgress);
  
  let allPrograms = [];
  let pageNumber = 1;
  let hasMore = true;
  
  // Helper function to check if a program meets requirements
  const checkProgramMeetsRequirements = (attrs) => {
    if (requireSubmission && attrs.submission_state !== 'open') return false;
    if (requireBounties && !attrs.offers_bounties) return false;
    if (requireOpenScope && !attrs.open_scope) return false;
    if (requireSafeHarbor && !attrs.gold_standard_safe_harbor) return false;
    return true;
  };
  
  const hasRequirements = requireSubmission || requireBounties || requireOpenScope || requireSafeHarbor;
  let programsThatMeetRequirements = [];

  try {
    while (hasMore) {
      // If we have requirements and a limit, stop fetching once we have enough
      if (hasRequirements && limit && programsThatMeetRequirements.length >= limit) {
        console.log(`[SCAN] Found ${programsThatMeetRequirements.length} programs that meet requirements, stopping fetch`);
        break;
      }
      
      console.log(`[SCAN] Fetching page ${pageNumber}...`);
      const response = await axios.get('https://api.hackerone.com/v1/hackers/programs', {
        auth: {
          username: username,
          password: token
        },
        headers: {
          'Accept': 'application/json'
        },
        params: {
          'page[size]': 100,
          'page[number]': pageNumber
        }
      });

      const programs = response.data.data || [];
      console.log(`[SCAN] Page ${pageNumber}: Found ${programs.length} programs`);
      
      programs.forEach((program) => {
        if (program && program.attributes && program.attributes.handle) {
          allPrograms.push(program);
          
          // If we have requirements, check if this program meets them
          if (hasRequirements) {
            if (checkProgramMeetsRequirements(program.attributes)) {
              programsThatMeetRequirements.push(program);
            }
          }
          
          if (allPrograms.length <= 10) {
            console.log(`[SCAN] Found program: ${program.attributes.handle} - ${program.attributes.name || 'N/A'}`);
          }
        }
      });

      const links = response.data.links;
      if (links && links.next) {
        pageNumber++;
      } else {
        hasMore = false;
      }
    }

    console.log(`[SCAN] Total programs fetched: ${allPrograms.length}`);
    
    if (allPrograms.length === 0) {
      console.log('[SCAN] WARNING: No programs found from API');
      return res.status(404).json({ error: 'No programs found' });
    }

    // Apply filtering and limiting based on requirements
    if (hasRequirements) {
      if (programsThatMeetRequirements.length === 0) {
        console.log('[SCAN] WARNING: No programs found that meet the requirements');
        return res.status(404).json({ error: 'No programs found that meet the specified requirements' });
      }
      
      console.log(`[SCAN] Found ${programsThatMeetRequirements.length} programs that meet requirements`);
      
      // If we have a limit, randomly select from programs that meet requirements
      if (limit && programsThatMeetRequirements.length > limit) {
        console.log(`[SCAN] Randomly selecting ${limit} programs from ${programsThatMeetRequirements.length} that meet requirements`);
        for (let i = programsThatMeetRequirements.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [programsThatMeetRequirements[i], programsThatMeetRequirements[j]] = [programsThatMeetRequirements[j], programsThatMeetRequirements[i]];
        }
        programsThatMeetRequirements = programsThatMeetRequirements.slice(0, limit);
      }
      
      allPrograms = programsThatMeetRequirements;
      console.log(`[SCAN] Selected ${allPrograms.length} programs that meet requirements for scanning`);
    } else if (limit && limit < allPrograms.length) {
      // No requirements, just randomly select from all programs
      console.log(`[SCAN] Randomly selecting ${limit} programs from ${allPrograms.length} total programs`);
      for (let i = allPrograms.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPrograms[i], allPrograms[j]] = [allPrograms[j], allPrograms[i]];
      }
      allPrograms = allPrograms.slice(0, limit);
      console.log(`[SCAN] Selected ${allPrograms.length} random programs for scanning`);
    }

    currentScanProgress = { current: 0, total: allPrograms.length, status: 'scanning', message: '' };
    broadcastProgress(currentScanProgress);

    console.log(`[SCAN] Starting scan of ${allPrograms.length} programs`);
    res.json({ success: true, total: allPrograms.length });

    const saveProgram = async (program, index) => {
    try {
      const attrs = program.attributes;
      const handle = attrs.handle;
      const programName = attrs.name || handle;
      console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Processing program: ${handle} - ${programName}`);

      // Note: Requirements are already checked during the fetch phase, so all programs here should meet requirements
      // But we'll keep this check as a safety measure
      if (requireSubmission && attrs.submission_state !== 'open') {
        console.log(`[SCAN] [${index + 1}/${allPrograms.length}] WARNING: ${handle} doesn't meet submission requirement (should have been filtered)`);
        currentScanProgress.current = index + 1;
        broadcastProgress(currentScanProgress);
        return;
      }
      if (requireBounties && !attrs.offers_bounties) {
        console.log(`[SCAN] [${index + 1}/${allPrograms.length}] WARNING: ${handle} doesn't meet bounties requirement (should have been filtered)`);
        currentScanProgress.current = index + 1;
        broadcastProgress(currentScanProgress);
        return;
      }
      if (requireOpenScope && !attrs.open_scope) {
        console.log(`[SCAN] [${index + 1}/${allPrograms.length}] WARNING: ${handle} doesn't meet open scope requirement (should have been filtered)`);
        currentScanProgress.current = index + 1;
        broadcastProgress(currentScanProgress);
        return;
      }
      if (requireSafeHarbor && !attrs.gold_standard_safe_harbor) {
        console.log(`[SCAN] [${index + 1}/${allPrograms.length}] WARNING: ${handle} doesn't meet safe harbor requirement (should have been filtered)`);
        currentScanProgress.current = index + 1;
        broadcastProgress(currentScanProgress);
        return;
      }

      currentScanProgress.current = index;
      currentScanProgress.currentProgram = programName;
      broadcastProgress(currentScanProgress);

      db.run(
        `INSERT OR REPLACE INTO programs (
          handle, name, currency, policy, profile_picture, submission_state,
          triage_active, state, started_accepting_at, number_of_reports_for_user,
          number_of_valid_reports_for_user, bounty_earned_for_user,
          last_invitation_accepted_at_for_user, bookmarked, allows_bounty_splitting,
          offers_bounties, open_scope, fast_payments, gold_standard_safe_harbor, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`,
        [
          attrs.handle,
          attrs.name,
          attrs.currency,
          attrs.policy,
          attrs.profile_picture,
          attrs.submission_state,
          attrs.triage_active,
          attrs.state,
          attrs.started_accepting_at,
          attrs.number_of_reports_for_user,
          attrs.number_of_valid_reports_for_user,
          attrs.bounty_earned_for_user,
          attrs.last_invitation_accepted_at_for_user,
          attrs.bookmarked ? 1 : 0,
          attrs.allows_bounty_splitting ? 1 : 0,
          attrs.offers_bounties ? 1 : 0,
          attrs.open_scope ? 1 : 0,
          attrs.fast_payments ? 1 : 0,
          attrs.gold_standard_safe_harbor ? 1 : 0
        ]
      );

      try {
        console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Fetching scope for: ${handle}`);
        currentScanProgress.currentProgram = programName;
        currentScanProgress.message = 'Fetching Scope Targets';
        currentScanProgress.scopeCount = 0;
        broadcastProgress(currentScanProgress);
        
        const allScopes = [];
        let pageNumber = 1;
        let hasMore = true;

        while (hasMore) {
          const scopeResponse = await axios.get(`https://api.hackerone.com/v1/hackers/programs/${handle}/structured_scopes`, {
            auth: {
              username: username,
              password: token
            },
            headers: {
              'Accept': 'application/json'
            },
            params: {
              'page[size]': 100,
              'page[number]': pageNumber
            }
          }).catch((error) => {
            if (error.response) {
              if (error.response.status === 404) {
                console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Structured scopes endpoint not found for ${handle} (404) - may be VDP or private`);
              } else if (error.response.status === 403) {
                console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Access forbidden for ${handle} structured scopes (403)`);
              } else {
                console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Error fetching scope for ${handle}: ${error.response.status} - ${error.response.statusText}`);
              }
            } else {
              console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Network error fetching scope for ${handle}: ${error.message}`);
            }
            return null;
          });

          if (!scopeResponse) {
            break;
          }

          const scopes = scopeResponse.data.data || [];
          allScopes.push(...scopes);
          
          currentScanProgress.scopeCount = allScopes.length;
          broadcastProgress(currentScanProgress);

          const links = scopeResponse.data.links;
          if (links && links.next) {
            pageNumber++;
          } else {
            hasMore = false;
          }
        }

        // Apply scope limit if enabled
        let scopesToSave = allScopes;
        if (scopeLimit && allScopes.length > scopeLimit) {
          console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Limiting scope targets from ${allScopes.length} to ${scopeLimit} for: ${handle}`);
          // Randomly select scope targets
          for (let i = allScopes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allScopes[i], allScopes[j]] = [allScopes[j], allScopes[i]];
          }
          scopesToSave = allScopes.slice(0, scopeLimit);
        }

        if (scopesToSave.length > 0) {
          console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Found ${scopesToSave.length} scope targets for: ${handle}`);
          db.run('DELETE FROM scope_targets WHERE program_handle = ?', [handle]);
          
          const scopePromises = scopesToSave.map((scope) => {
            return new Promise((resolve) => {
              const scopeAttrs = scope.attributes;
              db.run(
                `INSERT INTO scope_targets (
                  program_handle, target_type, target, eligible_for_bounty,
                  eligible_for_submission, instruction, severity_rating
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                  handle,
                  scopeAttrs.asset_type || 'unknown',
                  scopeAttrs.asset_identifier || '',
                  scopeAttrs.eligible_for_bounty ? 1 : 0,
                  scopeAttrs.eligible_for_submission ? 1 : 0,
                  scopeAttrs.instruction || '',
                  scopeAttrs.max_severity || ''
                ],
                (err) => {
                  if (err) {
                    console.error(`[SCAN] Error saving scope target for ${handle}:`, err);
                  }
                  resolve();
                }
              );
            });
          });
          
          await Promise.all(scopePromises);
          db.get('SELECT COUNT(*) as count FROM scope_targets WHERE program_handle = ?', [handle], (err, row) => {
            if (!err && row) {
              console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Saved ${row.count} scope targets for: ${handle}`);
            }
          });

          // Test URL scope targets
          console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Testing URL scope targets for: ${handle}`);
          currentScanProgress.message = 'Testing Scope Targets';
          broadcastProgress(currentScanProgress);
          
          db.all('SELECT id, target_type, target FROM scope_targets WHERE program_handle = ? AND (target_type = "URL" OR target_type = "url" OR target_type LIKE "%url%" OR target LIKE "http://%" OR target LIKE "https://%")', [handle], async (err, urlTargets) => {
            if (!err && urlTargets && urlTargets.length > 0) {
              console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Found ${urlTargets.length} URL targets to test for: ${handle}`);
              
              for (const urlTarget of urlTargets) {
                await testUrlTarget(urlTarget.id, urlTarget.target, handle);
                // Small delay to avoid overwhelming servers
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              
              console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Completed testing URL targets for: ${handle}`);
            }
          });
        } else {
          console.log(`[SCAN] [${index + 1}/${allPrograms.length}] No scope targets found for: ${handle}`);
        }
      } catch (scopeError) {
        console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Could not fetch scope for ${handle}:`, scopeError.message);
      }

      currentScanProgress.current = index + 1;
      currentScanProgress.currentProgram = programName;
      currentScanProgress.message = '';
      currentScanProgress.scopeCount = null;
      broadcastProgress(currentScanProgress);
      console.log(`[SCAN] [${index + 1}/${allPrograms.length}] Saved to database: ${handle}`);
    } catch (error) {
      console.error(`[SCAN] [${index + 1}/${allPrograms.length}] Error saving program:`, error.message);
      currentScanProgress.current = index + 1;
      if (program && program.attributes) {
        currentScanProgress.currentProgram = program.attributes.name || program.attributes.handle;
      }
      broadcastProgress(currentScanProgress);
    }
  };

  console.log(`[SCAN] Beginning sequential save of ${allPrograms.length} programs...`);
  for (let i = 0; i < allPrograms.length; i++) {
    await saveProgram(allPrograms[i], i);
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`[SCAN] Scan complete! Processed ${allPrograms.length} programs`);
    currentScanProgress.status = 'complete';
    broadcastProgress(currentScanProgress);
  } catch (error) {
    console.log('[SCAN] Error fetching programs from API:', error.message);
    if (error.response) {
      console.log('[SCAN] Response status:', error.response.status);
      console.log('[SCAN] Response data:', error.response.data);
    }
    return res.status(500).json({ error: 'Failed to fetch programs from API', details: error.message });
  }
});

app.get('/api/programs', (req, res) => {
  const { search, filter } = req.query;
  let query = 'SELECT * FROM programs WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (handle LIKE ? OR name LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (filter) {
    try {
      const filters = JSON.parse(filter);
      Object.keys(filters).forEach(key => {
        if (filters[key] !== '' && filters[key] !== null && filters[key] !== undefined) {
          if (key === 'offers_bounties' || key === 'open_scope' || key === 'fast_payments' || key === 'bookmarked') {
            query += ` AND ${key} = ?`;
            params.push(filters[key] ? 1 : 0);
          } else if (key === 'min_bounty') {
            query += ' AND bounty_earned_for_user >= ?';
            params.push(filters[key]);
          } else {
            query += ` AND ${key} LIKE ?`;
            params.push(`%${filters[key]}%`);
          }
        }
      });
    } catch (e) {
    }
  }

  query += ' ORDER BY name ASC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const programsWithScope = rows.map((program) => {
      return new Promise((resolve) => {
          db.all(
          'SELECT * FROM scope_targets WHERE program_handle = ?',
          [program.handle],
          (scopeErr, scopeTargets) => {
            if (scopeErr) {
              resolve({ ...program, scope_targets: [] });
            } else {
              // Fetch test results for each scope target
              if (!scopeTargets || scopeTargets.length === 0) {
                resolve({ ...program, scope_targets: [] });
                return;
              }
              
              const targetsWithTests = scopeTargets.map((target) => {
                return new Promise((resolveTarget) => {
                  db.get(
                    'SELECT * FROM scope_target_tests WHERE scope_target_id = ? ORDER BY test_date DESC LIMIT 1',
                    [target.id],
                    (testErr, testResult) => {
                      resolveTarget({
                        ...target,
                        test_result: testResult || null
                      });
                    }
                  );
                });
              });
              
              Promise.all(targetsWithTests).then((targets) => {
                resolve({ ...program, scope_targets: targets });
              });
            }
          }
        );
      });
    });
    
    Promise.all(programsWithScope).then((programs) => {
      res.json(programs);
    });
  });
});

app.get('/api/export', (req, res) => {
  const { format = 'csv' } = req.query;
  const query = 'SELECT * FROM programs ORDER BY name ASC';
  
  db.all(query, [], (err, programs) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const programsWithScope = programs.map((program) => {
      return new Promise((resolve) => {
        db.all(
          'SELECT * FROM scope_targets WHERE program_handle = ?',
          [program.handle],
          (scopeErr, scopeTargets) => {
            if (scopeErr) {
              resolve({ ...program, scope_targets: [] });
            } else {
              // Fetch test results for each scope target
              if (!scopeTargets || scopeTargets.length === 0) {
                resolve({ ...program, scope_targets: [] });
                return;
              }
              
              const targetsWithTests = scopeTargets.map((target) => {
                return new Promise((resolveTarget) => {
                  db.get(
                    'SELECT * FROM scope_target_tests WHERE scope_target_id = ? ORDER BY test_date DESC LIMIT 1',
                    [target.id],
                    (testErr, testResult) => {
                      resolveTarget({
                        ...target,
                        test_result: testResult || null
                      });
                    }
                  );
                });
              });
              
              Promise.all(targetsWithTests).then((targets) => {
                resolve({ ...program, scope_targets: targets });
              });
            }
          }
        );
      });
    });
    
    Promise.all(programsWithScope).then((programsData) => {
      if (format === 'pdf') {
        // Generate PDF - require pdfkit only when needed
        let PDFDocument;
        try {
          PDFDocument = require('pdfkit');
        } catch (error) {
          return res.status(500).json({ error: 'PDF export not available. Please install pdfkit: npm install pdfkit' });
        }
        
        const doc = new PDFDocument({ margin: 50 });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=hackerone-scan-report.pdf');
        
        doc.pipe(res);
        
        // Title
        doc.fontSize(20).text('HackerOne Program Scan Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);
        
        // Programs data
        programsData.forEach((program, programIndex) => {
          if (programIndex > 0) {
            doc.addPage();
          }
          
          // Program header
          doc.fontSize(16).fillColor('#00ff88').text(program.name || program.handle, { underline: true });
          doc.fillColor('#000000');
          doc.moveDown(0.5);
          
          doc.fontSize(10);
          doc.text(`Handle: ${program.handle || 'N/A'}`);
          doc.text(`State: ${program.state || 'N/A'}`);
          doc.text(`Submission State: ${program.submission_state || 'N/A'}`);
          doc.text(`Offers Bounties: ${program.offers_bounties ? 'Yes' : 'No'}`);
          doc.text(`Open Scope: ${program.open_scope ? 'Yes' : 'No'}`);
          doc.text(`Fast Payments: ${program.fast_payments ? 'Yes' : 'No'}`);
          doc.text(`Safe Harbor: ${program.gold_standard_safe_harbor ? 'Yes' : 'No'}`);
          doc.moveDown();
          
          // Scope targets
          if (program.scope_targets && program.scope_targets.length > 0) {
            doc.fontSize(12).fillColor('#00ff88').text('Scope Targets:', { underline: true });
            doc.fillColor('#000000');
            doc.moveDown(0.5);
            
            program.scope_targets.forEach((target, idx) => {
              if (idx > 0) doc.moveDown(0.3);
              doc.fontSize(9);
              doc.text(`Type: ${target.target_type || 'Unknown'}`, { indent: 20 });
              doc.text(`Target: ${target.target || 'N/A'}`, { indent: 20 });
              doc.text(`Bounty Eligible: ${target.eligible_for_bounty ? 'Yes' : 'No'}`, { indent: 20 });
              doc.text(`Submission Eligible: ${target.eligible_for_submission ? 'Yes' : 'No'}`, { indent: 20 });
              if (target.test_result) {
                if (target.test_result.status_code) {
                  doc.text(`Status Code: ${target.test_result.status_code}`, { indent: 20 });
                }
                doc.text(`Has Auth: ${target.test_result.has_auth_indicators ? 'Yes' : 'No'}`, { indent: 20 });
              }
              if (target.severity_rating) {
                doc.text(`Severity: ${target.severity_rating}`, { indent: 20 });
              }
            });
          } else {
            doc.fontSize(10).text('No scope targets available');
          }
        });
        
        doc.end();
      } else {
        // Generate CSV
        const csvRows = [];
        
        // Header row
        csvRows.push([
          'Program Handle',
          'Program Name',
          'State',
          'Submission State',
          'Offers Bounties',
          'Open Scope',
          'Fast Payments',
          'Safe Harbor',
          'Scope Target Type',
          'Scope Target',
          'Bounty Eligible',
          'Submission Eligible',
          'Status Code',
          'Has Auth Indicators',
          'Severity Rating'
        ].join(','));
        
        // Data rows
        programsData.forEach((program) => {
          if (program.scope_targets && program.scope_targets.length > 0) {
            program.scope_targets.forEach((target) => {
              const row = [
                `"${program.handle || ''}"`,
                `"${program.name || ''}"`,
                `"${program.state || ''}"`,
                `"${program.submission_state || ''}"`,
                program.offers_bounties ? 'Yes' : 'No',
                program.open_scope ? 'Yes' : 'No',
                program.fast_payments ? 'Yes' : 'No',
                program.gold_standard_safe_harbor ? 'Yes' : 'No',
                `"${target.target_type || ''}"`,
                `"${target.target || ''}"`,
                target.eligible_for_bounty ? 'Yes' : 'No',
                target.eligible_for_submission ? 'Yes' : 'No',
                target.test_result?.status_code || '',
                target.test_result?.has_auth_indicators ? 'Yes' : 'No',
                `"${target.severity_rating || ''}"`
              ];
              csvRows.push(row.join(','));
            });
          } else {
            // Program with no scope targets
            const row = [
              `"${program.handle || ''}"`,
              `"${program.name || ''}"`,
              `"${program.state || ''}"`,
              `"${program.submission_state || ''}"`,
              program.offers_bounties ? 'Yes' : 'No',
              program.open_scope ? 'Yes' : 'No',
              program.fast_payments ? 'Yes' : 'No',
              program.gold_standard_safe_harbor ? 'Yes' : 'No',
              '',
              '',
              '',
              '',
              '',
              '',
              ''
            ];
            csvRows.push(row.join(','));
          }
        });
        
        const csvContent = csvRows.join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=hackerone-scan-report.csv');
        res.send(csvContent);
      }
    });
  });
});

app.get('/api/programs/stats', (req, res) => {
  db.get('SELECT COUNT(*) as total FROM programs', (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(row);
  });
});

app.get('/api/credentials', (req, res) => {
  db.get('SELECT username, token FROM api_config WHERE id = 1', (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (row) {
      res.json({ username: row.username, token: row.token });
    } else {
      res.json({ username: null, token: null });
    }
  });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected');
    ws.send(JSON.stringify({ type: 'progress', data: currentScanProgress }));
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
}

module.exports = app;

