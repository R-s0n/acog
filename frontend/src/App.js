import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function App() {
  const [showModal, setShowModal] = useState(false);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState({ text: '', type: '', show: false });
  const [progress, setProgress] = useState({ current: 0, total: 0, status: 'idle' });
  const [programs, setPrograms] = useState([]);
  const [filteredPrograms, setFilteredPrograms] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    submission_state: '',
    state: '',
    offers_bounties: '',
    open_scope: '',
    currency: '',
    fast_payments: '',
    scope_target_type: ''
  });
  const [ws, setWs] = useState(null);
  const [expandedPrograms, setExpandedPrograms] = useState(new Set());
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [enableLimit, setEnableLimit] = useState(false);
  const [scanLimit, setScanLimit] = useState(500);
  const [enableScopeLimit, setEnableScopeLimit] = useState(false);
  const [scopeLimit, setScopeLimit] = useState(100);
  const [requireSubmission, setRequireSubmission] = useState(false);
  const [requireBounties, setRequireBounties] = useState(false);
  const [requireOpenScope, setRequireOpenScope] = useState(false);
  const [requireSafeHarbor, setRequireSafeHarbor] = useState(false);
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [scopeFilters, setScopeFilters] = useState({});
  const [scopeSort, setScopeSort] = useState({});
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [hasLoadedPrograms, setHasLoadedPrograms] = useState(false);
  const [expandedScopeTargets, setExpandedScopeTargets] = useState(new Set());

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsHost;
    if (process.env.NODE_ENV === 'production') {
      wsHost = window.location.host;
    } else {
      wsHost = `${window.location.hostname}:5000`;
    }
    const websocket = new WebSocket(`${wsProtocol}//${wsHost}/ws`);
    
    websocket.onopen = () => {
      console.log('WebSocket connected');
    };
    
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        setProgress(data.data);
        if (data.data.status === 'complete') {
          setScanning(false);
          setTimeout(() => loadPrograms(), 1000);
        }
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setWs(websocket);

    return () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, []);

  useEffect(() => {
    loadCredentials();
    loadPrograms();
  }, []);

  useEffect(() => {
    if (!scanning && progress.status === 'idle') {
      loadPrograms();
    }
  }, [scanning, progress.status]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportMenu && !event.target.closest('.export-dropdown')) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  const loadCredentials = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/credentials`);
      if (response.data && response.data.username && response.data.token) {
        setUsername(response.data.username);
        setToken(response.data.token);
      }
    } catch (error) {
      console.error('Error loading credentials:', error);
    }
  };

  const loadPrograms = async () => {
    if (scanning) {
      return;
    }
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (Object.values(filters).some(f => f !== '')) {
        params.append('filter', JSON.stringify(filters));
      }
      
      const response = await axios.get(`${API_URL}/api/programs?${params}`);
      const loadedPrograms = response.data || [];
      setPrograms(loadedPrograms);
      
      if (loadedPrograms.length > 0) {
        setHasLoadedPrograms(true);
        if (showModal) {
          setShowModal(false);
        }
      } else {
        if (!hasLoadedPrograms && !showModal && !scanning && !searchTerm && Object.values(filters).every(f => f === '')) {
          setShowModal(true);
        }
      }
    } catch (error) {
      console.error('Error loading programs:', error);
      if (!hasLoadedPrograms && !showModal && !scanning) {
        setShowModal(true);
      }
    }
  };

  useEffect(() => {
    if (!scanning) {
    loadPrograms();
    }
  }, [searchTerm, filters]);

  useEffect(() => {
    if (programs.length > 0) {
      let filtered = [...programs];

      if (searchTerm) {
        filtered = filtered.filter(program => 
          (program.handle && program.handle.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (program.name && program.name.toLowerCase().includes(searchTerm.toLowerCase()))
        );
      }

      if (Object.values(filters).some(f => f !== '')) {
        filtered = filtered.filter(program => {
          if (filters.submission_state && program.submission_state !== filters.submission_state) return false;
          if (filters.state && program.state !== filters.state) return false;
          if (filters.offers_bounties !== '' && program.offers_bounties !== (filters.offers_bounties === 'true')) return false;
          if (filters.open_scope !== '' && program.open_scope !== (filters.open_scope === 'true')) return false;
          if (filters.currency && program.currency !== filters.currency) return false;
          if (filters.fast_payments !== '' && program.fast_payments !== (filters.fast_payments === 'true')) return false;
          
          if (filters.scope_target_type) {
            if (!program.scope_targets || program.scope_targets.length === 0) return false;
            
            const hasTargetType = program.scope_targets.some(target => {
              const targetType = target.target_type?.toLowerCase() || '';
              const targetValue = target.target?.toLowerCase() || '';
              
              switch (filters.scope_target_type) {
                case 'url':
                  return targetType.includes('url') || targetValue.startsWith('http://') || targetValue.startsWith('https://') || targetValue.startsWith('*.') && targetValue.includes('.');
                case 'wildcard':
                  return targetValue.includes('*');
                case 'mobile':
                  return targetType.includes('android') || targetType.includes('ios') || targetType.includes('mobile') || targetType.includes('application');
                case 'api':
                  return targetType.includes('api');
                case 'source_code':
                  return targetType.includes('source') || targetType.includes('code') || targetType.includes('downloadable');
                case 'hardware':
                  return targetType.includes('hardware') || targetType.includes('iot');
                case 'other':
                  return targetType.includes('other');
                default:
                  return targetType === filters.scope_target_type;
              }
            });
            
            if (!hasTargetType) return false;
          }
          
          return true;
        });
      }

      if (sortColumn) {
        filtered.sort((a, b) => {
          let aVal, bVal;
          
          switch (sortColumn) {
            case 'handle':
              aVal = a.handle || '';
              bVal = b.handle || '';
              break;
            case 'name':
              aVal = a.name || '';
              bVal = b.name || '';
              break;
            case 'state':
              aVal = a.state || '';
              bVal = b.state || '';
              break;
            case 'submission_state':
              aVal = a.submission_state || '';
              bVal = b.submission_state || '';
              break;
            case 'bounties':
              aVal = a.offers_bounties ? 1 : 0;
              bVal = b.offers_bounties ? 1 : 0;
              break;
            case 'open_scope':
              aVal = a.open_scope ? 1 : 0;
              bVal = b.open_scope ? 1 : 0;
              break;
            case 'safe_harbor':
              aVal = a.gold_standard_safe_harbor ? 1 : 0;
              bVal = b.gold_standard_safe_harbor ? 1 : 0;
              break;
            case 'scope_count':
              aVal = a.scope_targets?.length || 0;
              bVal = b.scope_targets?.length || 0;
              break;
            case 'xss_targets':
              const aGoodReflected = a.scope_targets?.filter(t => t.xss_analysis?.is_good_reflected_stored_target === 1).length || 0;
              const aGoodDom = a.scope_targets?.filter(t => t.xss_analysis?.is_good_dom_target === 1).length || 0;
              const bGoodReflected = b.scope_targets?.filter(t => t.xss_analysis?.is_good_reflected_stored_target === 1).length || 0;
              const bGoodDom = b.scope_targets?.filter(t => t.xss_analysis?.is_good_dom_target === 1).length || 0;
              aVal = aGoodReflected + aGoodDom;
              bVal = bGoodReflected + bGoodDom;
              break;
            default:
              return 0;
          }

          if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
          }

          if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
          if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
          return 0;
        });
      }

      setFilteredPrograms(filtered);
    }
  }, [programs, searchTerm, filters, sortColumn, sortDirection]);

  const showToast = (text, type) => {
    setToast({ text, type, show: true });
    setTimeout(() => {
      setToast({ text: '', type: '', show: false });
    }, 4000);
  };

  const testCredentials = async () => {
    setTesting(true);
    try {
      await axios.post(`${API_URL}/api/test-credentials`, { username, token });
      showToast('Credentials are valid!', 'success');
    } catch (error) {
      showToast(`Invalid credentials: ${error.response?.data?.error || error.message}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const startScan = async () => {
    setScanning(true);
    setProgress({ current: 0, total: 0, status: 'scanning', message: 'Fetching List of Public Programs' });
    try {
      const response = await axios.post(`${API_URL}/api/scan`, { 
        username, 
        token,
        limit: (showAdvancedOptions && enableLimit) ? scanLimit : null,
        scopeLimit: (showAdvancedOptions && enableScopeLimit) ? scopeLimit : null,
        requireSubmission: showAdvancedOptions ? requireSubmission : false,
        requireBounties: showAdvancedOptions ? requireBounties : false,
        requireOpenScope: showAdvancedOptions ? requireOpenScope : false,
        requireSafeHarbor: showAdvancedOptions ? requireSafeHarbor : false
      });
      setProgress({ current: 0, total: response.data.total, status: 'scanning', message: '' });
      setShowModal(false);
      
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        const pollProgress = setInterval(async () => {
          try {
            const statsResponse = await axios.get(`${API_URL}/api/programs/stats`);
            const currentCount = statsResponse.data.total;
            if (currentCount >= response.data.total) {
              clearInterval(pollProgress);
              setScanning(false);
              setProgress({ current: response.data.total, total: response.data.total, status: 'complete' });
              loadPrograms();
            }
          } catch (err) {
            console.error('Error polling progress:', err);
          }
        }, 2000);
        
        setTimeout(() => clearInterval(pollProgress), 600000);
      }
    } catch (error) {
      alert(`Error starting scan: ${error.response?.data?.error || error.message}`);
      setScanning(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleProgram = (programId) => {
    setExpandedPrograms(prev => {
      const newSet = new Set(prev);
      if (newSet.has(programId)) {
        newSet.delete(programId);
      } else {
        newSet.add(programId);
      }
      return newSet;
    });
  };

  const toggleScopeTarget = (targetId) => {
    setExpandedScopeTargets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(targetId)) {
        newSet.delete(targetId);
      } else {
        newSet.add(targetId);
      }
      return newSet;
    });
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const exportReport = async (format = 'csv') => {
    try {
      setShowExportMenu(false);
      const response = await axios.get(`${API_URL}/api/export?format=${format}`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const extension = format === 'pdf' ? 'pdf' : 'csv';
      link.setAttribute('download', `hackerone-scan-report-${new Date().toISOString().split('T')[0]}.${extension}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting report:', error);
      showToast('Error exporting report. Please try again.', 'error');
    }
  };

  return (
    <div className="app">
      {toast.show && (
        <div className={`toast toast-${toast.type}`}>
          {toast.text}
        </div>
      )}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>HackerOne API Configuration</h2>
            <div className="form-group">
              <label>Username:</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={scanning}
              />
            </div>
            <div className="form-group">
              <label>API Token:</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={scanning}
              />
            </div>
            <div className="advanced-options">
              <button 
                type="button"
                className="advanced-toggle"
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              >
                {showAdvancedOptions ? '▼' : '▶'} Advanced Scan Options
              </button>
              {showAdvancedOptions && (
                <div className="advanced-content">
                  <div className="advanced-layout">
                    <div className="advanced-sliders">
                      <div className="form-group">
                        <div className="limit-control-row">
                          <div className="slider-label-row">
                            <label className="slider-label">
                              Program Limit: <span className="slider-value">{scanLimit}</span>
                            </label>
                            <label className="limit-checkbox-label">
                              <input
                                type="checkbox"
                                className="limit-checkbox"
                                checked={enableLimit}
                                onChange={(e) => setEnableLimit(e.target.checked)}
                                disabled={scanning}
                              />
                            </label>
                          </div>
                          <input
                            type="range"
                            className="slider-input"
                            min="1"
                            max="500"
                            value={scanLimit}
                            onChange={(e) => setScanLimit(parseInt(e.target.value))}
                            disabled={scanning || !enableLimit}
                          />
                          <div className="slider-labels">
                            <span>1</span>
                            <span>500</span>
                          </div>
                        </div>
                      </div>
                      <div className="form-group">
                        <div className="limit-control-row">
                          <div className="slider-label-row">
                            <label className="slider-label">
                              Scope Target Limit: <span className="slider-value">{scopeLimit}</span>
                            </label>
                            <label className="limit-checkbox-label">
                              <input
                                type="checkbox"
                                className="limit-checkbox"
                                checked={enableScopeLimit}
                                onChange={(e) => setEnableScopeLimit(e.target.checked)}
                                disabled={scanning}
                              />
                            </label>
                          </div>
                          <input
                            type="range"
                            className="slider-input"
                            min="1"
                            max="500"
                            value={scopeLimit}
                            onChange={(e) => setScopeLimit(parseInt(e.target.value))}
                            disabled={scanning || !enableScopeLimit}
                          />
                          <div className="slider-labels">
                            <span>1</span>
                            <span>500</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="program-requirements">
                      <label className="requirement-checkbox-label">
                        <input
                          type="checkbox"
                          className="limit-checkbox"
                          checked={requireSubmission}
                          onChange={(e) => setRequireSubmission(e.target.checked)}
                          disabled={scanning}
                        />
                        <span className="requirement-checkbox-text">Require Submission</span>
                      </label>
                      <label className="requirement-checkbox-label">
                        <input
                          type="checkbox"
                          className="limit-checkbox"
                          checked={requireBounties}
                          onChange={(e) => setRequireBounties(e.target.checked)}
                          disabled={scanning}
                        />
                        <span className="requirement-checkbox-text">Require Bounties</span>
                      </label>
                      <label className="requirement-checkbox-label">
                        <input
                          type="checkbox"
                          className="limit-checkbox"
                          checked={requireOpenScope}
                          onChange={(e) => setRequireOpenScope(e.target.checked)}
                          disabled={scanning}
                        />
                        <span className="requirement-checkbox-text">Require Open Scope</span>
                      </label>
                      <label className="requirement-checkbox-label">
                        <input
                          type="checkbox"
                          className="limit-checkbox"
                          checked={requireSafeHarbor}
                          onChange={(e) => setRequireSafeHarbor(e.target.checked)}
                          disabled={scanning}
                        />
                        <span className="requirement-checkbox-text">Require Safe Harbor</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-buttons">
              <button onClick={testCredentials} disabled={testing || scanning || !username || !token}>
                {testing ? 'Testing...' : 'Test Credentials'}
              </button>
              <button onClick={startScan} disabled={scanning || !username || !token}>
                Start Scan
              </button>
            </div>
          </div>
        </div>
      )}

      {scanning && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Scanning Programs...</h2>
            <div className="progress-container">
              <div className="spinner"></div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%'
                  }}
                ></div>
              </div>
              <p className="progress-text">
                {progress.total === 0 && progress.message ? (
                  progress.message
                ) : (
                  <div className="progress-info">
                    {progress.currentProgram ? (
                      <div className="progress-details">
                        <div className="progress-program">
                          {progress.current} / {progress.total} - Scanning: <strong>{progress.currentProgram}</strong>
                        </div>
                        {progress.currentScopeTarget && progress.totalScopeTargets > 0 && (
                          <div className="progress-scope-target">
                            <span className="scope-target-url">{progress.currentScopeTarget}</span>
                            <span className="scope-target-count">
                              ({progress.currentScopeTargetNumber}/{progress.totalScopeTargets} Scope Targets)
                            </span>
                          </div>
                        )}
                        {progress.message === 'Fetching Scope Targets' && progress.scopeCount !== null && progress.scopeCount !== undefined && (
                          <span className="scope-info">({progress.scopeCount} scope targets)</span>
                        )}
                      </div>
                    ) : (
                      <span>{progress.current} / {progress.total}</span>
                    )}
                  </div>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="container">
        <header>
          <h1>HackerOne Program Scanner</h1>
          <div className="header-buttons">
            <div className="export-dropdown">
              <button 
                onClick={() => setShowExportMenu(!showExportMenu)} 
                className="config-button export-button"
                disabled={programs.length === 0}
              >
                Export Report ▼
              </button>
              {showExportMenu && (
                <div className="export-menu">
                  <button onClick={() => exportReport('csv')} className="export-option">
                    Export as CSV
                  </button>
                  <button onClick={() => exportReport('pdf')} className="export-option">
                    Export as PDF
                  </button>
                </div>
              )}
            </div>
            <button 
              onClick={() => setShowModal(true)} 
              className="config-button"
            >
              New Scan
            </button>
          </div>
        </header>

        <div className="filters">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search programs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <select
              value={filters.submission_state}
              onChange={(e) => handleFilterChange('submission_state', e.target.value)}
            >
              <option value="">All Submission States</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <select
              value={filters.state}
              onChange={(e) => handleFilterChange('state', e.target.value)}
            >
              <option value="">All States</option>
              <option value="public_mode">Public Mode</option>
              <option value="private_mode">Private Mode</option>
            </select>
            <select
              value={filters.offers_bounties}
              onChange={(e) => handleFilterChange('offers_bounties', e.target.value)}
            >
              <option value="">All Programs</option>
              <option value="true">Offers Bounties</option>
              <option value="false">No Bounties</option>
            </select>
            <select
              value={filters.open_scope}
              onChange={(e) => handleFilterChange('open_scope', e.target.value)}
            >
              <option value="">All Scopes</option>
              <option value="true">Open Scope</option>
              <option value="false">Closed Scope</option>
            </select>
            <select
              value={filters.currency}
              onChange={(e) => handleFilterChange('currency', e.target.value)}
            >
              <option value="">All Currencies</option>
              <option value="usd">USD</option>
              <option value="eur">EUR</option>
              <option value="gbp">GBP</option>
            </select>
            <select
              value={filters.fast_payments}
              onChange={(e) => handleFilterChange('fast_payments', e.target.value)}
            >
              <option value="">All Programs</option>
              <option value="true">Fast Pay</option>
              <option value="false">No Fast Pay</option>
            </select>
            <select
              value={filters.scope_target_type}
              onChange={(e) => handleFilterChange('scope_target_type', e.target.value)}
            >
              <option value="">All Scope Types</option>
              <option value="url">URL Targets</option>
              <option value="wildcard">Wildcard Targets</option>
              <option value="mobile">Mobile Targets</option>
              <option value="api">API Targets</option>
              <option value="source_code">Source Code</option>
              <option value="hardware">Hardware/IoT</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="programs-list">
              {filteredPrograms.length === 0 ? (
            <div className="no-data">
                    {programs.length === 0 ? 'No programs loaded. Start a scan to begin.' : 'No programs match your filters.'}
            </div>
          ) : (
            <>
              <div className="program-header program-header-row">
                <div className="program-header-content">
                  <div className="program-handle sortable" onClick={() => handleSort('handle')}>
                    Handle {sortColumn === 'handle' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-name sortable" onClick={() => handleSort('name')}>
                    Name {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-state sortable" onClick={() => handleSort('state')}>
                    State {sortColumn === 'state' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-submission-state sortable" onClick={() => handleSort('submission_state')}>
                    Submission {sortColumn === 'submission_state' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-bounties sortable" onClick={() => handleSort('bounties')}>
                    Bounties {sortColumn === 'bounties' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-scope sortable" onClick={() => handleSort('open_scope')}>
                    Open Scope {sortColumn === 'open_scope' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-safe-harbor sortable" onClick={() => handleSort('safe_harbor')}>
                    Safe Harbor {sortColumn === 'safe_harbor' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-xss-targets sortable" onClick={() => handleSort('xss_targets')}>
                    XSS Targets {sortColumn === 'xss_targets' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-scope-count sortable" onClick={() => handleSort('scope_count')}>
                    Scopes {sortColumn === 'scope_count' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="program-expand"></div>
                </div>
              </div>
              {filteredPrograms.map((program) => {
              const isExpanded = expandedPrograms.has(program.id);
              const goodReflectedTargets = program.scope_targets?.filter(t => t.xss_analysis?.is_good_reflected_stored_target === 1).length || 0;
              const goodDomTargets = program.scope_targets?.filter(t => t.xss_analysis?.is_good_dom_target === 1).length || 0;
              const hasGoodXssTargets = goodReflectedTargets > 0 || goodDomTargets > 0;
              
              return (
                <div key={program.id} className="program-accordion">
                  <div 
                    className="program-header"
                    onClick={() => toggleProgram(program.id)}
                  >
                    <div className="program-header-content">
                      <div className="program-handle">
                        <a 
                          href={`https://hackerone.com/${program.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {program.handle}
                        </a>
                      </div>
                      <div className="program-name">{program.name}</div>
                      <div className="program-state">{program.state === 'public_mode' ? 'Public' : program.state === 'private_mode' ? 'Private' : program.state}</div>
                      <div className="program-submission-state">{program.submission_state}</div>
                      <div className="program-bounties">{program.offers_bounties ? 'Yes' : 'No'}</div>
                      <div className="program-scope">{program.open_scope ? 'Yes' : 'No'}</div>
                      <div className="program-safe-harbor">{program.gold_standard_safe_harbor ? 'Yes' : 'No'}</div>
                      <div className="program-xss-targets">
                        {hasGoodXssTargets ? (
                          <div className="xss-targets-indicator">
                            {goodReflectedTargets > 0 && <span className="xss-count-reflected">{goodReflectedTargets} R/S</span>}
                            {goodDomTargets > 0 && <span className="xss-count-dom">{goodDomTargets} DOM</span>}
                          </div>
                        ) : (
                          <span className="xss-none">-</span>
                        )}
                      </div>
                      <div className="program-scope-count">{program.scope_targets?.length || 0}</div>
                      <div className="program-expand">{isExpanded ? '−' : '+'}</div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="program-details">
                      <div className="program-detail-section">
                        <h3>Program Information</h3>
                        <div className="detail-grid">
                          <div className="detail-item">
                            <strong>Triage Active:</strong>
                            <div className="detail-value">{program.triage_active || 'N/A'}</div>
                          </div>
                          <div className="detail-item">
                            <strong>Started Accepting At:</strong>
                            <div className="detail-value">{program.started_accepting_at || 'N/A'}</div>
                          </div>
                          <div className="detail-item">
                            <strong>Bookmarked:</strong>
                            <div className="detail-value">{program.bookmarked ? 'Yes' : 'No'}</div>
                          </div>
                          <div className="detail-item">
                            <strong>Allows Bounty Splitting:</strong>
                            <div className="detail-value">{program.allows_bounty_splitting ? 'Yes' : 'No'}</div>
                          </div>
                          <div className="detail-item">
                            <strong>Gold Standard Safe Harbor:</strong>
                            <div className="detail-value">{program.gold_standard_safe_harbor ? 'Yes' : 'No'}</div>
                          </div>
                          <div className="detail-item">
                            <strong>Last Invitation Accepted:</strong>
                            <div className="detail-value">{program.last_invitation_accepted_at_for_user || 'N/A'}</div>
                          </div>
                        </div>
                      </div>
                      <div className="program-detail-section">
                        <h3>
                          Scope Targets (
                          {(() => {
                            if (!program.scope_targets || program.scope_targets.length === 0) return 0;
                            const filter = scopeFilters[program.id];
                            if (!filter || (!filter.eligibility && !filter.type)) {
                              return program.scope_targets.length;
                            }
                            let filtered = [...program.scope_targets];
                            if (filter.eligibility) {
                              if (filter.eligibility === 'bounty') {
                                filtered = filtered.filter(t => t.eligible_for_bounty);
                              } else if (filter.eligibility === 'submission') {
                                filtered = filtered.filter(t => t.eligible_for_submission);
                              } else if (filter.eligibility === 'both') {
                                filtered = filtered.filter(t => t.eligible_for_bounty && t.eligible_for_submission);
                              } else if (filter.eligibility === 'out-of-scope') {
                                filtered = filtered.filter(t => !t.eligible_for_bounty && !t.eligible_for_submission);
                              }
                            }
                            if (filter.type) {
                              filtered = filtered.filter(t => t.target_type === filter.type);
                            }
                            return filtered.length;
                          })()}
                          {(() => {
                            const filter = scopeFilters[program.id];
                            if (filter && (filter.eligibility || filter.type)) {
                              return ` / ${program.scope_targets?.length || 0}`;
                            }
                            return '';
                          })()}
                          )
                        </h3>
                        {program.scope_targets && program.scope_targets.length > 0 ? (
                          <>
                            <div className="scope-controls">
                              <div className="scope-filters">
                                <select
                                  value={scopeFilters[program.id]?.eligibility || ''}
                                  onChange={(e) => {
                                    setScopeFilters(prev => ({
                                      ...prev,
                                      [program.id]: { ...prev[program.id], eligibility: e.target.value }
                                    }));
                                  }}
                                  className="scope-filter-select"
                                >
                                  <option value="">All Eligibility</option>
                                  <option value="bounty">Bounty Eligible</option>
                                  <option value="submission">Submission Eligible</option>
                                  <option value="both">Both Bounty & Submission</option>
                                  <option value="out-of-scope">Out of Scope</option>
                                </select>
                                <select
                                  value={scopeFilters[program.id]?.type || ''}
                                  onChange={(e) => {
                                    setScopeFilters(prev => ({
                                      ...prev,
                                      [program.id]: { ...prev[program.id], type: e.target.value }
                                    }));
                                  }}
                                  className="scope-filter-select"
                                >
                                  <option value="">All Types</option>
                                  {[...new Set(program.scope_targets.map(t => t.target_type).filter(Boolean))].sort().map(type => (
                                    <option key={type} value={type}>{type}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="scope-sort">
                                <select
                                  value={scopeSort[program.id]?.column || ''}
                                  onChange={(e) => {
                                    const column = e.target.value;
                                    setScopeSort(prev => ({
                                      ...prev,
                                      [program.id]: {
                                        column,
                                        direction: prev[program.id]?.column === column && prev[program.id]?.direction === 'asc' ? 'desc' : 'asc'
                                      }
                                    }));
                                  }}
                                  className="scope-sort-select"
                                >
                                  <option value="">Sort by...</option>
                                  <option value="type">Type</option>
                                  <option value="target">Target</option>
                                  <option value="bounty">Bounty Eligible</option>
                                  <option value="submission">Submission Eligible</option>
                                  <option value="severity">Severity</option>
                                </select>
                                {scopeSort[program.id]?.column && (
                                  <span className="scope-sort-indicator">
                                    {scopeSort[program.id].direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="scope-targets-container">
                              {(() => {
                                let filtered = [...program.scope_targets];
                                const filter = scopeFilters[program.id];
                                
                                if (filter) {
                                  if (filter.eligibility) {
                                    if (filter.eligibility === 'bounty') {
                                      filtered = filtered.filter(t => t.eligible_for_bounty);
                                    } else if (filter.eligibility === 'submission') {
                                      filtered = filtered.filter(t => t.eligible_for_submission);
                                    } else if (filter.eligibility === 'both') {
                                      filtered = filtered.filter(t => t.eligible_for_bounty && t.eligible_for_submission);
                                    } else if (filter.eligibility === 'out-of-scope') {
                                      filtered = filtered.filter(t => !t.eligible_for_bounty && !t.eligible_for_submission);
                                    }
                                  }
                                  
                                  if (filter.type) {
                                    filtered = filtered.filter(t => t.target_type === filter.type);
                                  }
                                }
                                
                                const sort = scopeSort[program.id];
                                if (sort && sort.column) {
                                  filtered.sort((a, b) => {
                                    let aVal, bVal;
                                    
                                    switch (sort.column) {
                                      case 'type':
                                        aVal = a.target_type || '';
                                        bVal = b.target_type || '';
                                        break;
                                      case 'target':
                                        aVal = a.target || '';
                                        bVal = b.target || '';
                                        break;
                                      case 'bounty':
                                        aVal = a.eligible_for_bounty ? 1 : 0;
                                        bVal = b.eligible_for_bounty ? 1 : 0;
                                        break;
                                      case 'submission':
                                        aVal = a.eligible_for_submission ? 1 : 0;
                                        bVal = b.eligible_for_submission ? 1 : 0;
                                        break;
                                      case 'severity':
                                        aVal = a.severity_rating || '';
                                        bVal = b.severity_rating || '';
                                        break;
                                      default:
                                        return 0;
                                    }
                                    
                                    if (typeof aVal === 'string') {
                                      aVal = aVal.toLowerCase();
                                      bVal = bVal.toLowerCase();
                                    }
                                    
                                    if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
                                    if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
                                    return 0;
                                  });
                                } else {
                                  const getTypePriority = (type) => {
                                    const typeLower = (type || '').toLowerCase();
                                    if (typeLower === 'url' || typeLower.includes('url')) return 1;
                                    if (typeLower === 'wildcard' || typeLower.includes('wildcard')) return 2;
                                    if (typeLower === 'mobile' || typeLower.includes('mobile') || typeLower.includes('android') || typeLower.includes('ios')) return 3;
                                    return 4;
                                  };
                                  
                                  filtered.sort((a, b) => {
                                    const aTypePriority = getTypePriority(a.target_type);
                                    const bTypePriority = getTypePriority(b.target_type);
                                    
                                    if (aTypePriority !== bTypePriority) {
                                      return aTypePriority - bTypePriority;
                                    }
                                    
                                    const aIsGoodReflected = a.xss_analysis?.is_good_reflected_stored_target === 1;
                                    const aIsGoodDom = a.xss_analysis?.is_good_dom_target === 1;
                                    const bIsGoodReflected = b.xss_analysis?.is_good_reflected_stored_target === 1;
                                    const bIsGoodDom = b.xss_analysis?.is_good_dom_target === 1;
                                    
                                    const aIsGood = aIsGoodReflected || aIsGoodDom;
                                    const bIsGood = bIsGoodReflected || bIsGoodDom;
                                    
                                    if (aIsGood && !bIsGood) return -1;
                                    if (!aIsGood && bIsGood) return 1;
                                    
                                    const aScore = Math.max(a.xss_analysis?.reflected_stored_score || 0, a.xss_analysis?.dom_score || 0);
                                    const bScore = Math.max(b.xss_analysis?.reflected_stored_score || 0, b.xss_analysis?.dom_score || 0);
                                    
                                    if (aScore !== bScore) {
                                      return bScore - aScore;
                                    }
                                    
                                    return 0;
                                  });
                                }
                                
                                const isUrl = (str) => {
                                  if (!str) return false;
                                  const urlPattern = /^(https?:\/\/|http:\/\/|https:\/\/)/i;
                                  return urlPattern.test(str) || (str.includes('.') && (str.startsWith('http://') || str.startsWith('https://') || str.includes('://')));
                                };
                                
                                const getUrl = (str) => {
                                  if (!str) return null;
                                  if (str.startsWith('http://') || str.startsWith('https://')) return str;
                                  if (isUrl(str)) return str;
                                  if (str.includes('.') && !str.includes(' ')) return `https://${str}`;
                                  return null;
                                };
                                
                                return filtered.map((target, idx) => {
                                  const isOutOfScope = !target.eligible_for_bounty && !target.eligible_for_submission;
                                  const testResult = target.test_result;
                                  const xssAnalysis = target.xss_analysis;
                                  const targetKey = `${program.id}-${target.id}`;
                                  const isExpanded = expandedScopeTargets.has(targetKey);
                                  const hasXssData = xssAnalysis && xssAnalysis.status_code;
                                  const targetUrl = getUrl(target.target);
                                  
                                  return (
                                    <div key={idx} className="scope-target-accordion">
                                      <div 
                                        className="scope-target-line"
                                        onClick={() => hasXssData && toggleScopeTarget(targetKey)}
                                        style={{ cursor: hasXssData ? 'pointer' : 'default' }}
                                      >
                                        <span className="scope-target-type">{target.target_type || 'Unknown'}</span>
                                        {targetUrl ? (
                                          <a 
                                            href={targetUrl} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="scope-target-value scope-target-link"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {target.target || 'N/A'}
                                          </a>
                                        ) : (
                                          <span className="scope-target-value">{target.target || 'N/A'}</span>
                                        )}
                                        {isOutOfScope ? (
                                          <span className="scope-badge scope-badge-out-of-scope">Out of Scope</span>
                                        ) : (
                                          <>
                                            {target.eligible_for_bounty && (
                                              <span className="scope-badge scope-badge-bounty">Bounty</span>
                                            )}
                                            {target.eligible_for_submission && (
                                              <span className="scope-badge scope-badge-submission">Submission</span>
                                            )}
                                          </>
                                        )}
                                        {testResult && (
                                          <>
                                            {testResult.status_code && (
                                              <span className={`scope-status-badge status-${Math.floor(testResult.status_code / 100)}xx`}>
                                                {testResult.status_code}
                                              </span>
                                            )}
                                            {testResult.has_auth_indicators === 1 && (
                                              <span className="scope-badge scope-badge-auth">Auth</span>
                                            )}
                                          </>
                                        )}
                                        {xssAnalysis && xssAnalysis.is_good_reflected_stored_target === 1 && (
                                          <span className="scope-badge scope-badge-reflected-xss">✓ Reflected/Stored XSS</span>
                                        )}
                                        {xssAnalysis && xssAnalysis.is_good_dom_target === 1 && (
                                          <span className="scope-badge scope-badge-dom-xss">✓ DOM XSS</span>
                                        )}
                                        {target.severity_rating && (
                                          <span className="scope-severity-inline">Severity: {target.severity_rating}</span>
                                        )}
                                        {hasXssData && (
                                          <span className="scope-expand-icon">{isExpanded ? '−' : '+'}</span>
                                        )}
                                      </div>
                                      {isExpanded && xssAnalysis && (
                                        <div className="scope-target-details">
                                          <div className="xss-analysis-section">
                                            <div className="xss-analysis-type">
                                              <h4>🎯 Reflected/Stored XSS Analysis</h4>
                                              <div className="xss-summary">
                                                <div className="xss-score-badge" style={{
                                                  background: xssAnalysis.reflected_stored_score >= 70 ? '#00ff88' : xssAnalysis.reflected_stored_score >= 50 ? '#ffaa00' : '#ff4444',
                                                  color: '#000'
                                                }}>
                                                  Score: {xssAnalysis.reflected_stored_score}/100
                                                </div>
                                                <div className="xss-target-status">
                                                  {xssAnalysis.is_good_reflected_stored_target ? '✓ Good Target' : '✗ Not Recommended'}
                                                </div>
                                              </div>
                                              <div className="xss-reason">
                                                <strong>Verdict:</strong> {xssAnalysis.reflected_stored_reason || 'No reason provided'}
                                              </div>
                                              <div className="xss-explanation">
                                                <p><strong>Why?</strong> Reflected and stored XSS attacks work best on traditional server-side rendered applications. 
                                                Virtual DOM frameworks (React, Vue, Angular, Svelte) automatically escape user input by default, making traditional XSS significantly harder. 
                                                {xssAnalysis.is_good_reflected_stored_target ? 
                                                  ' This target lacks modern frameworks that provide automatic XSS protection, making it a good candidate for testing reflected/stored XSS vulnerabilities.' :
                                                  ' This target uses modern frontend frameworks with built-in XSS protections, making traditional reflected/stored XSS attacks much more difficult.'
                                                }</p>
                                              </div>
                                              <div className="xss-metrics-grid">
                                                <div className="xss-metric">
                                                  <span className="metric-label">Frameworks Detected:</span>
                                                  <span className="metric-value">{xssAnalysis.frameworks || 'None'}</span>
                                                </div>
                                              </div>
                                            </div>
                                            
                                            <div className="xss-analysis-type">
                                              <h4>⚡ DOM-Based XSS Analysis</h4>
                                              <div className="xss-summary">
                                                <div className="xss-score-badge" style={{
                                                  background: xssAnalysis.dom_score >= 25 ? '#00ff88' : xssAnalysis.dom_score >= 15 ? '#ffaa00' : '#ff4444',
                                                  color: '#000'
                                                }}>
                                                  Score: {xssAnalysis.dom_score}/100
                                                </div>
                                                <div className="xss-target-status">
                                                  {xssAnalysis.is_good_dom_target ? '✓ Good Target' : '✗ Not Recommended'}
                                                </div>
                                              </div>
                                              <div className="xss-reason">
                                                <strong>Verdict:</strong> {xssAnalysis.dom_reason || 'No reason provided'}
                                              </div>
                                              <div className="xss-explanation">
                                                <p><strong>Why?</strong> DOM-based XSS occurs when JavaScript code unsafely handles user-controllable data (like URL parameters). 
                                                Good targets have dangerous sinks (innerHTML, eval, etc.), accessible sources (location.hash, etc.), and weak security policies. 
                                                {xssAnalysis.is_good_dom_target ? 
                                                  ' This target has promising indicators like dangerous JavaScript patterns, accessible sources, or vulnerable libraries that make DOM XSS more likely.' :
                                                  ' This target lacks sufficient indicators (dangerous sinks, accessible sources, vulnerable patterns) to be a prime DOM XSS candidate.'
                                                }</p>
                                              </div>
                                              <div className="xss-metrics-grid">
                                                <div className="xss-metric">
                                                  <span className="metric-label">Custom JavaScript Files:</span>
                                                  <span className="metric-value">{xssAnalysis.custom_js_count || 0}</span>
                                                  <span className="metric-description">Number of custom JS files (not libraries)</span>
                                                </div>
                                                <div className="xss-metric">
                                                  <span className="metric-label">Dangerous Sinks:</span>
                                                  <span className="metric-value">{xssAnalysis.dangerous_sinks_count || 0}</span>
                                                  <span className="metric-description">innerHTML, eval, document.write, etc.</span>
                                                </div>
                                                <div className="xss-metric">
                                                  <span className="metric-label">Untrusted Sources:</span>
                                                  <span className="metric-value">{xssAnalysis.sources_count || 0}</span>
                                                  <span className="metric-description">location.hash, location.search, etc.</span>
                                                </div>
                                                <div className="xss-metric">
                                                  <span className="metric-label">Prototype Pollution Vectors:</span>
                                                  <span className="metric-value">{xssAnalysis.prototype_pollution_count || 0}</span>
                                                  <span className="metric-description">Object.assign, __proto__, etc.</span>
                                                </div>
                                              </div>
                                            </div>
                                            
                                            <div className="xss-security-section">
                                              <h4>🛡️ Security Posture</h4>
                                              <div className="xss-metrics-grid">
                                                <div className="xss-metric">
                                                  <span className="metric-label">Content Security Policy:</span>
                                                  <span className={`metric-value ${!xssAnalysis.has_csp ? 'metric-good' : xssAnalysis.csp_strict ? 'metric-bad' : 'metric-warning'}`}>
                                                    {xssAnalysis.has_csp ? (xssAnalysis.csp_strict ? 'Strict ✓' : 'Weak ⚠') : 'None ✗'}
                                                  </span>
                                                  <span className="metric-description">
                                                    {!xssAnalysis.has_csp ? 'No CSP - easier to exploit' : xssAnalysis.csp_strict ? 'Strict CSP - harder to bypass' : 'Weak CSP - may be bypassable'}
                                                  </span>
                                                </div>
                                                <div className="xss-metric">
                                                  <span className="metric-label">Web Application Firewall:</span>
                                                  <span className={`metric-value ${xssAnalysis.has_waf ? 'metric-bad' : 'metric-good'}`}>
                                                    {xssAnalysis.has_waf ? 'Detected ✓' : 'None ✗'}
                                                  </span>
                                                  <span className="metric-description">
                                                    {xssAnalysis.has_waf ? 'WAF present - payloads may be blocked' : 'No WAF detected - less likely to block payloads'}
                                                  </span>
                                                </div>
                                                <div className="xss-metric">
                                                  <span className="metric-label">Authentication:</span>
                                                  <span className="metric-value">{xssAnalysis.has_auth ? 'Detected' : 'None'}</span>
                                                  <span className="metric-description">
                                                    {xssAnalysis.has_auth ? 'Auth detected - may need login for full testing' : 'No auth detected - easier to test'}
                                                  </span>
                                                </div>
                                                {xssAnalysis.vulnerable_libraries && xssAnalysis.vulnerable_libraries !== '[]' && (() => {
                                                  try {
                                                    const libs = JSON.parse(xssAnalysis.vulnerable_libraries);
                                                    if (libs.length > 0) {
                                                      return (
                                                        <div className="xss-metric xss-vuln-libs-metric">
                                                          <span className="metric-label">Vulnerable Libraries:</span>
                                                          <div className="metric-value metric-good">
                                                            {libs.map((lib, i) => (
                                                              <span key={i} className="vuln-lib-badge">
                                                                {lib.library} {lib.version}
                                                              </span>
                                                            ))}
                                                          </div>
                                                          <span className="metric-description">
                                                            Known vulnerable versions detected - potential exploitation vectors
                                                          </span>
                                                        </div>
                                                      );
                                                    }
                                                  } catch (e) {}
                                                  return null;
                                                })()}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </>
                        ) : (
                          <div className="no-scope">No scope targets available</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </>
          )}
        </div>

        <div className="stats">
          <p>Total Programs: {programs.length}</p>
        </div>
      </div>
    </div>
  );
}

export default App;

