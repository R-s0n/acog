Get Programs
Hacker ResourcesProgramsGet Programs
Code samples

# You can also use wget
curl "https://api.hackerone.com/v1/hackers/programs" \
  -X GET \
  -u "<YOUR_API_USERNAME>:<YOUR_API_TOKEN>" \
  -H 'Accept: application/json'

programs found

{
  "data": [
    {
      "id": 9,
      "type": "program",
      "attributes": {
        "handle": "acme",
        "name": "acme",
        "currency": "usd",
        "policy": "acme's program policy.",
        "profile_picture": "/assets/global-elements/add-team.png",
        "submission_state": "open",
        "triage_active": null,
        "state": "public_mode",
        "started_accepting_at": null,
        "number_of_reports_for_user": 0,
        "number_of_valid_reports_for_user": 0,
        "bounty_earned_for_user": 0,
        "last_invitation_accepted_at_for_user": null,
        "bookmarked": false,
        "allows_bounty_splitting": false,
        "offers_bounties": true,
        "open_scope": true,
        "fast_payments": true,
        "gold_standard_safe_harbor": false
      }
    }
  ],
  "links": {}
}
Last revised: 2025-08-26

GET /hackers/programs

This API endpoint allows you to query a paginated list of program objects.

Parameters

Name	In	Type	Required	Description
page[number]	query	integer	false	The page to retrieve from. The default is set to 1.
page[size]	query	integer	false	The number of objects per page (currently limited from 1 to 100). The default is set to 25.
Get Program
Hacker ResourcesProgramsGet Program
Code samples

# You can also use wget
curl "https://api.hackerone.com/v1/hackers/programs/{handle}" \
  -X GET \
  -u "<YOUR_API_USERNAME>:<YOUR_API_TOKEN>" \
  -H 'Accept: application/json'

program found

{
  "data": {
    "id": 9,
    "type": "program",
    "attributes": {
      "handle": "acme",
      "name": "acme",
      "currency": "usd",
      "policy": "acme's program policy.",
      "profile_picture": "/assets/global-elements/add-team.png",
      "submission_state": "open",
      "triage_active": null,
      "state": "public_mode",
      "started_accepting_at": null,
      "number_of_reports_for_user": 0,
      "number_of_valid_reports_for_user": 0,
      "bounty_earned_for_user": 0,
      "last_invitation_accepted_at_for_user": null,
      "bookmarked": false,
      "allows_bounty_splitting": false,
      "offers_bounties": true,
      "open_scope": true,
      "fast_payments": true,
      "gold_standard_safe_harbor": false
    },
    "relationships": {
      "structured_scopes": {
        "data": []
      }
    }
  }
}