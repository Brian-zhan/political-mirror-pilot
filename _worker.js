// pilot/build-info.json
var build_info_default = {
  version: "0.37.2",
  buildHash: "f5eaaff91d5ccc9b03bb7fbc240cd4b5ed592e0a37448a15b537024a2c8f5e04",
  sourceManifestHash: "439b4dc3ac6cd7b884976530230e99f088b7d82e9998e299b04c8db49be88934",
  studyVersion: "0.38.3-pilot.1",
  presentationVersion: "0.38.3-readability.1"
};

// pilot-cloud/schema-statements.json
var schema_statements_default = [
  "-- Maintainer reference: automatically initialized by the Worker. Not a user setup step.\n-- Political Mirror 0.38.2-cx.1 / schema 4. Use a NEW dedicated D1, not C15x or a live older PM database.\n-- No manual Secrets. Configure using the supplied offline settings page.\nCREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, applied_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS study_run (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  run_id TEXT NOT NULL,\n  run_key_sha256 TEXT NOT NULL,\n  study_version TEXT NOT NULL,\n  active_config_sha256 TEXT,            -- researcher configuration currently shown to new participants (NULL = not configured)\n  recruitment_open INTEGER NOT NULL DEFAULT 0,  -- 0 by default: the researcher opens recruitment explicitly\n  config_locked_at TEXT,                -- set when the first human participant consents; configuration is frozen afterwards\n  created_at TEXT NOT NULL\n);",
  "-- Append-only: every configuration ever shown to a participant stays retrievable by hash.\nCREATE TABLE IF NOT EXISTS config_snapshots (\n  researcher_config_sha256 TEXT PRIMARY KEY,\n  consent_template_version TEXT NOT NULL,\n  consent_text_sha256 TEXT NOT NULL,\n  researcher_config_json TEXT NOT NULL,\n  consent_document_json TEXT NOT NULL,\n  study_version TEXT NOT NULL,\n  first_seen_at TEXT NOT NULL,\n  saved_by TEXT NOT NULL DEFAULT 'researcher'\n);",
  "-- Test (QA) sessions are numbered separately and never count toward the human quota.\nCREATE TABLE IF NOT EXISTS test_slot_reservations (\n  slot INTEGER PRIMARY KEY,\n  enrollment_hash TEXT NOT NULL UNIQUE,\n  at TEXT NOT NULL\n);",
  "-- Race-free slot allocation: the slot number is computed inside the INSERT statement itself\n-- (single SQLite writer, one implicit transaction), so concurrent enrollments never read a\n-- stale count. Reservation AND session/consent now commit in one batch. Reservations are keyed by the client's enrollment key so a retry after a lost\n-- response reuses its reservation instead of burning a slot. Rows are never deleted.\nCREATE TABLE IF NOT EXISTS slot_reservations (\n  slot INTEGER PRIMARY KEY,\n  enrollment_hash TEXT NOT NULL UNIQUE,\n  at TEXT NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS sessions (\n  session_id TEXT PRIMARY KEY,\n  slot INTEGER NOT NULL UNIQUE,\n  run_id TEXT NOT NULL,\n  arm TEXT NOT NULL CHECK (arm IN ('TRUE','SHUFFLED')),\n  form_order TEXT NOT NULL,\n  assignment_json TEXT NOT NULL,\n  enrollment_hash TEXT NOT NULL UNIQUE,\n  token_hash TEXT NOT NULL,\n  study_version TEXT NOT NULL,\n  consent_config_json TEXT NOT NULL,\n  consent_json TEXT,                    -- the consent record accepted at enrollment (server time)\n  is_test INTEGER NOT NULL DEFAULT 0,   -- 1 = researcher-issued test session (server-controlled, excluded from analysis)\n  removed_at TEXT,                      -- data removal executed by the researcher (tombstone keeps the slot consumed)\n  removal_note TEXT,\n  revision INTEGER NOT NULL DEFAULT 0,\n  stage TEXT,\n  status TEXT,\n  consented_at TEXT,\n  checkpoint_json TEXT,\n  checkpoint_sha256 TEXT,\n  prediction_json TEXT,\n  prediction_receipt_json TEXT,\n  last_event_sha256 TEXT,\n  technical_error_count INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);",
  "CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions (status, stage);",
  "-- Revision chain: a stale write must fail as a SQL error so that D1 batch() rolls back the\n-- whole write atomically (a conditional UPDATE that touches 0 rows would not fail by itself).\nCREATE TRIGGER IF NOT EXISTS sessions_revision_chain BEFORE UPDATE OF revision ON sessions\nWHEN NEW.revision != OLD.revision + 1\nBEGIN SELECT RAISE(ABORT, 'REVISION_CONFLICT'); END;",
  "CREATE TABLE IF NOT EXISTS session_events (\n  session_id TEXT NOT NULL REFERENCES sessions (session_id),\n  sequence INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  request_id TEXT,\n  at TEXT NOT NULL,\n  revision INTEGER NOT NULL,\n  stage TEXT,\n  record_sha256 TEXT NOT NULL,\n  previous_sha256 TEXT,\n  summary_json TEXT NOT NULL,\n  PRIMARY KEY (session_id, sequence)\n);",
  "CREATE TABLE IF NOT EXISTS session_requests (\n  session_id TEXT NOT NULL REFERENCES sessions (session_id),\n  request_id TEXT NOT NULL,\n  kind TEXT NOT NULL,\n  digest TEXT NOT NULL,\n  result_json TEXT NOT NULL,\n  at TEXT NOT NULL,\n  PRIMARY KEY (session_id, request_id)\n);",
  "CREATE TABLE IF NOT EXISTS consent_records (\n  session_id TEXT PRIMARY KEY REFERENCES sessions (session_id),\n  consent_version TEXT NOT NULL,\n  consent_text_sha256 TEXT NOT NULL,\n  researcher_config_sha256 TEXT NOT NULL,\n  consent_json TEXT NOT NULL,\n  consented_at TEXT NOT NULL,\n  recorded_at TEXT NOT NULL,\n  revision INTEGER NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS prediction_commits (\n  session_id TEXT PRIMARY KEY REFERENCES sessions (session_id),\n  prediction_sha256 TEXT NOT NULL,\n  model_version TEXT NOT NULL,\n  actor_rule_version TEXT NOT NULL,\n  case_bank_version TEXT NOT NULL,\n  study_version TEXT NOT NULL,\n  core_hash TEXT NOT NULL,\n  form TEXT NOT NULL,\n  committed_at TEXT NOT NULL,\n  revision INTEGER NOT NULL,\n  commit_json TEXT NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS prediction_items (\n  session_id TEXT NOT NULL REFERENCES sessions (session_id),\n  case_id TEXT NOT NULL,\n  position INTEGER NOT NULL,\n  dimension TEXT NOT NULL,\n  m0 REAL NOT NULL, m1 REAL NOT NULL, m2 REAL NOT NULL, m3 REAL NOT NULL,\n  m3_personalized INTEGER NOT NULL,\n  PRIMARY KEY (session_id, case_id)\n);",
  "CREATE TABLE IF NOT EXISTS researcher_audit (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  at TEXT NOT NULL,\n  action TEXT NOT NULL,\n  detail TEXT\n);",
  "-- v3 commit-time invariants. These guards execute INSIDE D1 batch() transactions.\n-- A failed guard raises a SQL error (not an UPDATE of zero rows), rolling back the WHOLE batch.\nCREATE TRIGGER IF NOT EXISTS run_config_locked_guard\nBEFORE UPDATE OF active_config_sha256 ON study_run\nWHEN OLD.config_locked_at IS NOT NULL AND NEW.active_config_sha256 IS NOT OLD.active_config_sha256\nBEGIN SELECT RAISE(ABORT, 'CONFIG_LOCKED_AFTER_FIRST_CONSENT'); END;",
  "CREATE TRIGGER IF NOT EXISTS run_lock_permanent_guard\nBEFORE UPDATE OF config_locked_at ON study_run\nWHEN OLD.config_locked_at IS NOT NULL AND NEW.config_locked_at IS NOT OLD.config_locked_at\nBEGIN SELECT RAISE(ABORT, 'CONFIG_LOCKED_AFTER_FIRST_CONSENT'); END;",
  "CREATE TRIGGER IF NOT EXISTS run_open_boolean_guard\nBEFORE UPDATE OF recruitment_open ON study_run\nWHEN NEW.recruitment_open IS NULL OR NEW.recruitment_open NOT IN (0, 1)\nBEGIN SELECT RAISE(ABORT, 'CONFIG_CHANGED_RELOAD_REQUIRED'); END;",
  "CREATE TRIGGER IF NOT EXISTS sessions_enrollment_commit_guard\nBEFORE INSERT ON sessions\nBEGIN\n  SELECT CASE WHEN NOT EXISTS (\n    SELECT 1 FROM study_run r JOIN config_snapshots c\n      ON c.researcher_config_sha256 = r.active_config_sha256\n    WHERE r.id = 1 AND r.run_id = NEW.run_id AND r.study_version = NEW.study_version\n      AND r.active_config_sha256 = json_extract(NEW.consent_config_json, '$.researcherConfigSha256')\n      AND c.consent_text_sha256 = json_extract(NEW.consent_config_json, '$.consentTextSha256')\n      AND c.consent_text_sha256 = json_extract(NEW.consent_json, '$.consentTextSha256')\n      AND c.researcher_config_sha256 = json_extract(NEW.consent_json, '$.researcherConfigSha256')\n  ) THEN RAISE(ABORT, 'CONSENT_CONFIG_MISMATCH') END;\n  SELECT CASE WHEN NEW.is_test = 0 AND NOT EXISTS (\n    SELECT 1 FROM study_run WHERE id = 1 AND recruitment_open = 1\n  ) THEN RAISE(ABORT, 'RECRUITMENT_CLOSED') END;\n  SELECT CASE WHEN NEW.is_test = 0 AND (SELECT COUNT(*) FROM sessions WHERE is_test = 0) >= COALESCE((\n    SELECT json_extract(c.researcher_config_json, '$.recruitment.targetAllocations')\n    FROM study_run r JOIN config_snapshots c ON c.researcher_config_sha256 = r.active_config_sha256 WHERE r.id = 1\n  ), 0) THEN RAISE(ABORT, 'NEW_ENROLLMENT_CLOSED') END;\n  SELECT CASE WHEN (NEW.is_test = 0 AND NOT EXISTS (\n    SELECT 1 FROM slot_reservations WHERE slot = NEW.slot AND enrollment_hash = NEW.enrollment_hash\n  )) OR (NEW.is_test = 1 AND NOT EXISTS (\n    SELECT 1 FROM test_slot_reservations WHERE slot = NEW.slot - 1000000 AND enrollment_hash = NEW.enrollment_hash\n  )) THEN RAISE(ABORT, 'RESERVATION_SESSION_MISMATCH') END;\nEND;",
  "-- Even an already authenticated request cannot alter a removed row. The remove operation itself\n-- is allowed because OLD.removed_at is NULL; it increments revision and clears all content.\nCREATE TRIGGER IF NOT EXISTS sessions_tombstone_permanent\nBEFORE UPDATE ON sessions WHEN OLD.removed_at IS NOT NULL\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS config_snapshots_no_update\nBEFORE UPDATE ON config_snapshots\nBEGIN SELECT RAISE(ABORT, 'CONFIG_SNAPSHOT_IMMUTABLE'); END;",
  "CREATE TRIGGER IF NOT EXISTS config_snapshots_no_delete\nBEFORE DELETE ON config_snapshots\nBEGIN SELECT RAISE(ABORT, 'CONFIG_SNAPSHOT_IMMUTABLE'); END;",
  "CREATE TRIGGER IF NOT EXISTS session_events_live_parent_insert\nBEFORE INSERT ON session_events\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS session_events_live_parent_update\nBEFORE UPDATE ON session_events\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS session_requests_live_parent_insert\nBEFORE INSERT ON session_requests\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS session_requests_live_parent_update\nBEFORE UPDATE ON session_requests\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS consent_records_live_parent_insert\nBEFORE INSERT ON consent_records\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS consent_records_live_parent_update\nBEFORE UPDATE ON consent_records\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS prediction_commits_live_parent_insert\nBEFORE INSERT ON prediction_commits\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS prediction_commits_live_parent_update\nBEFORE UPDATE ON prediction_commits\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS prediction_items_live_parent_insert\nBEFORE INSERT ON prediction_items\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "CREATE TRIGGER IF NOT EXISTS prediction_items_live_parent_update\nBEFORE UPDATE ON prediction_items\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;",
  "-- CX-style deployment: management is performed only through the authenticated D1 Console.\nCREATE TABLE IF NOT EXISTS private_runtime (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  runtime_key TEXT NOT NULL CHECK(length(runtime_key) = 64),\n  created_at TEXT NOT NULL\n);",
  "CREATE TRIGGER IF NOT EXISTS private_runtime_immutable_update BEFORE UPDATE ON private_runtime\nBEGIN SELECT RAISE(ABORT, 'PRIVATE_RUNTIME_IMMUTABLE'); END;",
  "CREATE TRIGGER IF NOT EXISTS private_runtime_immutable_delete BEFORE DELETE ON private_runtime\nBEGIN SELECT RAISE(ABORT, 'PRIVATE_RUNTIME_IMMUTABLE'); END;",
  "CREATE TABLE IF NOT EXISTS dashboard_settings (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  mode TEXT NOT NULL DEFAULT 'CLOSED' CHECK(mode IN ('TEST','HUMAN','CLOSED')),\n  config_sha256 TEXT,\n  consent_text_sha256 TEXT,\n  researcher_config_json TEXT,\n  consent_document_json TEXT,\n  updated_at TEXT\n);",
  "INSERT OR IGNORE INTO dashboard_settings(id,mode) VALUES(1,'CLOSED');",
  "CREATE TRIGGER IF NOT EXISTS dashboard_settings_no_delete BEFORE DELETE ON dashboard_settings\nBEGIN SELECT RAISE(ABORT,'DASHBOARD_SETTINGS_CANNOT_BE_DELETED'); END;",
  "CREATE TRIGGER IF NOT EXISTS dashboard_settings_locked BEFORE UPDATE ON dashboard_settings\nWHEN EXISTS(SELECT 1 FROM study_run WHERE id=1 AND config_locked_at IS NOT NULL)\n AND (NEW.config_sha256 IS NOT OLD.config_sha256 OR NEW.consent_text_sha256 IS NOT OLD.consent_text_sha256\n OR NEW.researcher_config_json IS NOT OLD.researcher_config_json OR NEW.consent_document_json IS NOT OLD.consent_document_json)\nBEGIN SELECT RAISE(ABORT,'CONFIG_LOCKED_AFTER_FIRST_CONSENT'); END;",
  "CREATE TRIGGER IF NOT EXISTS dashboard_settings_no_test_after_human BEFORE UPDATE ON dashboard_settings\nWHEN NEW.mode='TEST' AND EXISTS(SELECT 1 FROM sessions WHERE is_test=0)\nBEGIN SELECT RAISE(ABORT,'CANNOT_REOPEN_TEST_MODE_AFTER_HUMAN_ENROLLMENT'); END;",
  "CREATE TRIGGER IF NOT EXISTS dashboard_settings_validate BEFORE UPDATE ON dashboard_settings\nWHEN NEW.config_sha256 IS NOT NULL\nBEGIN\n SELECT CASE WHEN length(NEW.config_sha256)!=64 OR length(NEW.consent_text_sha256)!=64\n OR NOT json_valid(NEW.researcher_config_json) OR NOT json_valid(NEW.consent_document_json)\n THEN RAISE(ABORT,'INVALID_DASHBOARD_CONFIGURATION') END;\n -- Reusing an immutable hash with different contents must fail, not silently ignore the insert.\n SELECT CASE WHEN EXISTS(SELECT 1 FROM config_snapshots c WHERE c.researcher_config_sha256=NEW.config_sha256\n  AND (c.researcher_config_json IS NOT NEW.researcher_config_json OR c.consent_document_json IS NOT NEW.consent_document_json\n   OR c.consent_text_sha256 IS NOT NEW.consent_text_sha256))\n THEN RAISE(ABORT,'CONFIG_SNAPSHOT_IMMUTABLE') END;\nEND;",
  "-- A single dashboard UPDATE atomically saves the snapshot and changes the active pointer.\nCREATE TRIGGER IF NOT EXISTS dashboard_settings_apply AFTER UPDATE ON dashboard_settings\nBEGIN\n INSERT OR IGNORE INTO config_snapshots(researcher_config_sha256,consent_template_version,consent_text_sha256,\n  researcher_config_json,consent_document_json,study_version,first_seen_at,saved_by)\n SELECT NEW.config_sha256,'PM-CONSENT-5',NEW.consent_text_sha256,NEW.researcher_config_json,\n  NEW.consent_document_json,'0.38.3-pilot.1',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'cloudflare-d1-console'\n WHERE NEW.config_sha256 IS NOT NULL;\n UPDATE study_run SET active_config_sha256=NEW.config_sha256,\n  recruitment_open=CASE WHEN NEW.mode='HUMAN' THEN 1 ELSE 0 END WHERE id=1;\n INSERT INTO researcher_audit(at,action,detail) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),\n  'dashboard-settings',NEW.mode || ':' || COALESCE(NEW.config_sha256,'not-configured'));\nEND;",
  "-- Recheck the site mode at INSERT commit time, not merely in earlier Worker reads.\nCREATE TRIGGER IF NOT EXISTS cx_enrollment_mode_guard BEFORE INSERT ON sessions\nBEGIN\n SELECT CASE WHEN (NEW.is_test=1 AND (SELECT mode FROM dashboard_settings WHERE id=1)!='TEST')\n  OR (NEW.is_test=0 AND (SELECT mode FROM dashboard_settings WHERE id=1)!='HUMAN')\n THEN RAISE(ABORT,'COLLECTION_MODE_CHANGED') END;\n SELECT CASE WHEN NEW.is_test NOT IN(0,1) THEN RAISE(ABORT,'INVALID_COLLECTION_MODE') END;\n SELECT CASE WHEN (SELECT config_sha256 FROM dashboard_settings WHERE id=1)\n  IS NOT json_extract(NEW.consent_config_json,'$.researcherConfigSha256')\n THEN RAISE(ABORT,'CONSENT_CONFIG_MISMATCH') END;\nEND;",
  "-- test/human identity, allocation, credentials and consent ownership cannot change afterwards.\nCREATE TRIGGER IF NOT EXISTS cx_session_identity_immutable BEFORE UPDATE ON sessions\nWHEN NEW.is_test IS NOT OLD.is_test OR NEW.slot IS NOT OLD.slot OR NEW.run_id IS NOT OLD.run_id\n OR NEW.arm IS NOT OLD.arm OR NEW.form_order IS NOT OLD.form_order OR NEW.assignment_json IS NOT OLD.assignment_json\n OR NEW.enrollment_hash IS NOT OLD.enrollment_hash OR NEW.token_hash IS NOT OLD.token_hash\n OR NEW.session_id IS NOT OLD.session_id OR NEW.study_version IS NOT OLD.study_version\nBEGIN SELECT RAISE(ABORT,'SESSION_IDENTITY_IMMUTABLE'); END;",
  "-- Compact account-only dashboard. No public HTTP route serves these views.\nCREATE VIEW IF NOT EXISTS pm_status AS\nSELECT (SELECT mode FROM dashboard_settings WHERE id=1) AS mode,\n (SELECT COUNT(*) FROM sessions WHERE is_test=0) AS human_enrolled,\n (SELECT COUNT(*) FROM sessions WHERE is_test=0 AND status='complete') AS human_complete,\n (SELECT COUNT(*) FROM sessions WHERE is_test=0 AND status='withdrawn') AS human_withdrawn,\n (SELECT COUNT(*) FROM sessions WHERE is_test=0 AND removed_at IS NOT NULL) AS human_removed,\n (SELECT COUNT(*) FROM sessions WHERE is_test=1) AS test_enrolled,\n (SELECT COUNT(*) FROM sessions WHERE is_test=1 AND status='complete') AS test_complete,\n (SELECT config_locked_at FROM study_run WHERE id=1) AS config_locked_at;",
  "CREATE VIEW IF NOT EXISTS pm_progress AS\nSELECT session_id,is_test,slot,stage,status,\n COALESCE(json_array_length(checkpoint_json,'$.responses.T0'),0) AS T0,\n COALESCE(json_array_length(checkpoint_json,'$.responses.T1'),0) AS T1,\n COALESCE(json_array_length(checkpoint_json,'$.responses.T2'),0) AS T2,\n prediction_receipt_json IS NOT NULL AS prediction_committed,\n technical_error_count,created_at,updated_at,removed_at FROM sessions;",
  "CREATE VIEW IF NOT EXISTS pm_research_exports AS\nSELECT s.session_id,s.is_test,s.slot,\n json_object(\n  'schema','political-mirror-research-export/1','collector','pm-cloud-collector/3.1.0',\n  'exportedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),\n  'sessionId',s.session_id,'studyVersion',s.study_version,'assignment',json(s.assignment_json),\n  'consentConfig',json(s.consent_config_json),'consent',json(s.consent_json),\n  'test',json(CASE WHEN s.is_test=1 THEN 'true' ELSE 'false' END),\n  'simulated',json(CASE WHEN s.is_test=1 THEN 'true' ELSE 'false' END),\n  'slot',s.slot,'revision',s.revision,'checkpoint',json(s.checkpoint_json),\n  'prediction',json(s.prediction_json),'predictionReceipt',json(s.prediction_receipt_json),\n  'createdAt',s.created_at,'updatedAt',s.updated_at,'removedAt',s.removed_at,\n  'journalHeadSha256',s.last_event_sha256,'journalSequence',s.revision,\n  'consentDocument',json(c.consent_document_json),'researcherConfig',json(c.researcher_config_json),\n  'integrity',json_object(\n    'ok',json(CASE WHEN s.removed_at IS NOT NULL THEN 'null'\n     WHEN (SELECT COUNT(*) FROM session_events e WHERE e.session_id=s.session_id)=s.revision+1\n      AND (SELECT MIN(sequence) FROM session_events WHERE session_id=s.session_id)=0\n      AND (SELECT MAX(sequence) FROM session_events WHERE session_id=s.session_id)=s.revision\n      AND (SELECT record_sha256 FROM session_events WHERE session_id=s.session_id ORDER BY sequence DESC LIMIT 1) IS s.last_event_sha256\n      AND NOT EXISTS(SELECT 1 FROM session_events e LEFT JOIN session_events p\n        ON p.session_id=e.session_id AND p.sequence=e.sequence-1\n        WHERE e.session_id=s.session_id AND ((e.sequence=0 AND e.previous_sha256 IS NOT NULL)\n          OR (e.sequence>0 AND (p.sequence IS NULL OR e.previous_sha256 IS NOT p.record_sha256))))\n     THEN 'true' ELSE 'false' END),\n    'disposition',CASE WHEN s.removed_at IS NOT NULL THEN 'intentionally_removed' ELSE 'retained' END),\n  'events',json((SELECT json_group_array(json_object('session_id',e.session_id,'sequence',e.sequence,\n    'type',e.type,'at',e.at,'revision',e.revision,'stage',e.stage,'record_sha256',e.record_sha256,\n    'previous_sha256',e.previous_sha256,'summary',json(e.summary_json)))\n    FROM (SELECT * FROM session_events WHERE session_id=s.session_id ORDER BY sequence) e))\n ) AS research_json\nFROM sessions s LEFT JOIN config_snapshots c\n ON c.researcher_config_sha256=json_extract(s.consent_config_json,'$.researcherConfigSha256');",
  "-- One account-authenticated statement atomically removes all research contents. No public API.\n-- INSERT INTO pm_remove_data(session_id,note) VALUES('actual-session-id','withdrawal request');\nCREATE VIEW IF NOT EXISTS pm_remove_data AS SELECT session_id,removal_note AS note FROM sessions WHERE 0;",
  "CREATE TRIGGER IF NOT EXISTS pm_remove_data_apply INSTEAD OF INSERT ON pm_remove_data\nBEGIN\n SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE session_id=NEW.session_id)\n  THEN RAISE(ABORT,'SESSION_NOT_FOUND') END;\n UPDATE sessions SET revision=revision+1,checkpoint_json=NULL,checkpoint_sha256=NULL,\n  prediction_json=NULL,prediction_receipt_json=NULL,consent_json=NULL,last_event_sha256=NULL,\n  status='removed',stage='REMOVED',technical_error_count=0,\n  removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),removal_note=substr(NEW.note,1,500),\n  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')\n WHERE session_id=NEW.session_id AND removed_at IS NULL;\n DELETE FROM session_events WHERE session_id=NEW.session_id;\n DELETE FROM session_requests WHERE session_id=NEW.session_id;\n DELETE FROM prediction_items WHERE session_id=NEW.session_id;\n DELETE FROM prediction_commits WHERE session_id=NEW.session_id;\n DELETE FROM consent_records WHERE session_id=NEW.session_id;\n INSERT INTO researcher_audit(at,action,detail) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),\n  'dashboard-data-removed',NEW.session_id);\nEND;",
  "-- Auto-storage deployment metadata. No public HTTP endpoint can write this table.\nCREATE TABLE IF NOT EXISTS storage_installation (id INTEGER PRIMARY KEY CHECK(id=1), product TEXT NOT NULL, schema_version INTEGER NOT NULL);",
  "INSERT OR IGNORE INTO storage_installation VALUES(1,'political-mirror-autostorage',6);",
  "CREATE TABLE IF NOT EXISTS deployment_state (\n id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0,\n manifest_sha256 TEXT, config_sha256 TEXT, consent_text_sha256 TEXT,\n researcher_config_json TEXT, consent_document_json TEXT,\n removal_ids_json TEXT NOT NULL DEFAULT '[]',\n mode TEXT NOT NULL DEFAULT 'CLOSED' CHECK(mode IN('TEST','HUMAN','CLOSED')), updated_at TEXT\n);",
  "INSERT OR IGNORE INTO deployment_state(id,revision,mode) VALUES(1,0,'CLOSED');",
  "CREATE TRIGGER IF NOT EXISTS deployment_revision_monotonic BEFORE UPDATE ON deployment_state\nWHEN NEW.revision <= OLD.revision\nBEGIN SELECT RAISE(ABORT,'DEPLOYMENT_REVISION_NOT_NEWER'); END;",
  "CREATE TRIGGER IF NOT EXISTS deployment_state_apply AFTER UPDATE ON deployment_state\nBEGIN\n UPDATE dashboard_settings SET mode=NEW.mode,config_sha256=NEW.config_sha256,\n consent_text_sha256=NEW.consent_text_sha256,researcher_config_json=NEW.researcher_config_json,\n consent_document_json=NEW.consent_document_json,updated_at=NEW.updated_at WHERE id=1;\n INSERT INTO pm_remove_data(session_id,note) SELECT value,'Account-authorized deployment removal' FROM json_each(NEW.removal_ids_json);\nEND;",
  "-- An ordinary table (not just a SQL view) for the account owner's D1 Tables screen.\n-- One row per pseudonymous participant. No auth tokens or runtime secret in this table.\nCREATE TABLE IF NOT EXISTS participants (\n participant_code TEXT PRIMARY KEY,\n session_id TEXT NOT NULL UNIQUE,\n is_test INTEGER NOT NULL,\n status TEXT NOT NULL,\n last_stage TEXT,\n T0_answers INTEGER NOT NULL DEFAULT 0,\n T1_answers INTEGER NOT NULL DEFAULT 0,\n T2_answers INTEGER NOT NULL DEFAULT 0,\n prediction_saved INTEGER NOT NULL DEFAULT 0,\n updated_at TEXT NOT NULL,\n research_json TEXT NOT NULL,\n remove_requested INTEGER NOT NULL DEFAULT 0 CHECK(remove_requested IN(0,1))\n);",
  "CREATE TRIGGER IF NOT EXISTS participants_refresh AFTER INSERT ON session_events\nBEGIN\n INSERT INTO participants(participant_code,session_id,is_test,status,last_stage,\n T0_answers,T1_answers,T2_answers,prediction_saved,updated_at,research_json)\n SELECT CASE WHEN s.is_test=1 THEN printf('TEST%03d',s.slot-1000000+1) ELSE printf('P%03d',s.slot+1) END,\n s.session_id,s.is_test,s.status,s.stage,\n COALESCE(json_array_length(s.checkpoint_json,'$.responses.T0'),0),\n COALESCE(json_array_length(s.checkpoint_json,'$.responses.T1'),0),\n COALESCE(json_array_length(s.checkpoint_json,'$.responses.T2'),0),\n CASE WHEN s.prediction_receipt_json IS NULL THEN 0 ELSE 1 END,s.updated_at,e.research_json\n FROM sessions s JOIN pm_research_exports e ON e.session_id=s.session_id\n WHERE s.session_id=NEW.session_id AND s.removed_at IS NULL\n ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,last_stage=excluded.last_stage,\n T0_answers=excluded.T0_answers,T1_answers=excluded.T1_answers,T2_answers=excluded.T2_answers,\n prediction_saved=excluded.prediction_saved,updated_at=excluded.updated_at,research_json=excluded.research_json;\nEND;",
  "CREATE TRIGGER IF NOT EXISTS participants_clear AFTER UPDATE OF removed_at ON sessions\nWHEN NEW.removed_at IS NOT NULL\nBEGIN\n UPDATE participants SET status='removed',last_stage='REMOVED',T0_answers=0,T1_answers=0,T2_answers=0,\n prediction_saved=0,updated_at=NEW.updated_at,remove_requested=1,\n research_json=json_object('schema','political-mirror-research-export/1','sessionId',NEW.session_id,\n 'studyVersion',NEW.study_version,'slot',NEW.slot,'revision',NEW.revision,\n 'test',json(CASE WHEN NEW.is_test=1 THEN 'true' ELSE 'false' END),\n 'simulated',json(CASE WHEN NEW.is_test=1 THEN 'true' ELSE 'false' END),\n 'removedAt',NEW.removed_at,'checkpoint',NULL,'prediction',NULL,\n 'integrity',json_object('ok',NULL,'disposition','intentionally_removed'))\n WHERE session_id=NEW.session_id;\nEND;",
  "CREATE TRIGGER IF NOT EXISTS participants_removal_request AFTER UPDATE OF remove_requested ON participants\nWHEN NEW.remove_requested=1 AND OLD.remove_requested=0\n AND EXISTS(SELECT 1 FROM sessions WHERE session_id=NEW.session_id AND removed_at IS NULL)\nBEGIN\n INSERT INTO pm_remove_data(session_id,note) VALUES(NEW.session_id,'Cloudflare account data-removal request');\nEND;",
  "CREATE TRIGGER IF NOT EXISTS participants_no_direct_delete BEFORE DELETE ON participants\nBEGIN SELECT RAISE(ABORT,'SET_REMOVE_REQUESTED_INSTEAD_OF_DELETING_RECORD'); END;",
  "INSERT OR IGNORE INTO schema_version(id,version,applied_at) VALUES(1,6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));"
];

// pilot/sha256.mjs
var K = new Uint32Array([1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]);
var encoder = new TextEncoder();
function toBytes(input) {
  return input instanceof Uint8Array ? input : encoder.encode(String(input));
}
function sha256Bytes(input) {
  const msg = toBytes(input);
  const l = msg.length;
  const total = l + 9 + 63 >> 6 << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[l] = 128;
  const view = new DataView(buf.buffer);
  const bits2 = l * 8;
  view.setUint32(total - 8, Math.floor(bits2 / 4294967296));
  view.setUint32(total - 4, bits2 >>> 0);
  const h = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = w[i - 15], b2 = w[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = hh + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = h[i] >>> 24;
    out[i * 4 + 1] = h[i] >>> 16 & 255;
    out[i * 4 + 2] = h[i] >>> 8 & 255;
    out[i * 4 + 3] = h[i] & 255;
  }
  return out;
}
var hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
function sha256Hex(input) {
  return hex(sha256Bytes(input));
}
function hmacSha256Bytes(key, message2) {
  let k = toBytes(key);
  if (k.length > 64) k = sha256Bytes(k);
  const pad = new Uint8Array(64);
  pad.set(k);
  const ipad = pad.map((x) => x ^ 54), opad = pad.map((x) => x ^ 92);
  const inner = new Uint8Array(64 + toBytes(message2).length);
  inner.set(ipad);
  inner.set(toBytes(message2), 64);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(96);
  outer.set(opad);
  outer.set(innerHash, 64);
  return sha256Bytes(outer);
}
function hmacSha256Base64url(key, message2) {
  const bytes = hmacSha256Bytes(key, message2);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function timingSafeEqualString(a, b) {
  const x = toBytes(a), y = toBytes(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// pilot/assignment.mjs
var ASSIGNMENT_VERSION = "PM-BLOCK6-1";
var FORM_ORDERS = Object.freeze([["A", "B", "C"], ["B", "C", "A"], ["C", "A", "B"]]);
function assignmentForSlot(slot, runKey, runId = "pilot-run") {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error("INVALID_SLOT");
  const block = Math.floor(slot / 6), within = slot % 6;
  const forms = [0, 1, 2].sort((a, b) => sha256Hex(`${runKey}|${block}|form|${a}`).localeCompare(sha256Hex(`${runKey}|${block}|form|${b}`)));
  const form = forms[Math.floor(within / 2)];
  const firstTrue = (parseInt(sha256Hex(`${runKey}|${block}|arm|${form}`).slice(0, 2), 16) & 1) === 0;
  const arm = (within % 2 === 0 ? firstTrue : !firstTrue) ? "TRUE" : "SHUFFLED";
  return { slot, arm, formOrder: [...FORM_ORDERS[form]], assignmentVersion: ASSIGNMENT_VERSION, runId };
}
function stableJSON(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJSON).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableJSON(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function enrollmentToken(runKey, sessionId, requestId) {
  return hmacSha256Base64urlWrapper(runKey, "PM-ENROLL|" + sessionId + "|" + requestId);
}
function hmacSha256Base64urlWrapper(key, message2) {
  return hmacSha256Base64url(key, message2);
}

// pilot/researcher-config.mjs
var RESEARCHER_CONFIG_SCHEMA = "pm-researcher-config/2";
var ETHICS_ARRANGEMENTS = Object.freeze(["SUPERVISOR_HANDLED", "COMMITTEE_APPROVED", "COMMITTEE_EXEMPT", "NOT_SUPPLIED"]);
var PLACEHOLDER = /TODO|PLACEHOLDER|XXXX|FAKE|TBD|EXAMPLE|LOREM|填入|待填/i;
var text = (v) => typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
function loadResearcherConfig(raw) {
  if (!raw || typeof raw !== "object" || raw.schema !== void 0 && raw.schema !== RESEARCHER_CONFIG_SCHEMA) throw new Error("INVALID_RESEARCHER_CONFIG_SCHEMA");
  raw = { ...raw, schema: RESEARCHER_CONFIG_SCHEMA };
  const ethics = raw.ethics && typeof raw.ethics === "object" ? raw.ethics : {};
  const recruitment = raw.recruitment && typeof raw.recruitment === "object" ? raw.recruitment : {};
  const config = {
    schema: raw.schema,
    studyTitle: text(raw.studyTitle),
    principalInvestigator: text(raw.principalInvestigator),
    institution: text(raw.institution),
    contactEmail: text(raw.contactEmail),
    estimatedDurationMinutes: Number.isFinite(raw.estimatedDurationMinutes) && raw.estimatedDurationMinutes > 0 ? Math.round(raw.estimatedDurationMinutes) : null,
    durationEstimateBasis: text(raw.durationEstimateBasis),
    dataRetention: text(raw.dataRetention),
    dataAccess: text(raw.dataAccess),
    withdrawalProcedure: text(raw.withdrawalProcedure),
    ethics: {
      arrangement: ETHICS_ARRANGEMENTS.includes(ethics.arrangement) ? ethics.arrangement : "NOT_SUPPLIED",
      statement: text(ethics.statement),
      body: text(ethics.body),
      reference: text(ethics.reference),
      researcherConfirmed: ethics.researcherConfirmed === true
    },
    recruitment: {
      targetAllocations: Number.isSafeInteger(recruitment.targetAllocations) && recruitment.targetAllocations > 0 ? recruitment.targetAllocations : 20,
      allocationRule: text(recruitment.allocationRule) || "The first 20 allocated sessions (consented and randomised) count toward the pilot, including later dropouts; completion rates are reported.",
      stopRule: text(recruitment.stopRule) || "Recruitment stops when 20 sessions are allocated or at the declared cutoff date, whichever comes first; no participant is added or removed on the basis of results."
    }
  };
  const blockers = [];
  if (!config.studyTitle) blockers.push("STUDY_TITLE_MISSING");
  if (!config.contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.contactEmail)) blockers.push("CONTACT_EMAIL_MISSING");
  if (!config.principalInvestigator) blockers.push("PRINCIPAL_INVESTIGATOR_NOT_SUPPLIED");
  if (!config.institution) blockers.push("INSTITUTION_NOT_SUPPLIED");
  if (!config.estimatedDurationMinutes || !config.durationEstimateBasis) blockers.push("DURATION_ESTIMATE_NOT_SUPPLIED");
  if (!config.dataRetention) blockers.push("DATA_RETENTION_NOT_SUPPLIED");
  if (!config.dataAccess) blockers.push("DATA_ACCESS_NOT_SUPPLIED");
  if (!config.withdrawalProcedure) blockers.push("WITHDRAWAL_PROCEDURE_NOT_SUPPLIED");
  if (config.ethics.arrangement === "NOT_SUPPLIED" || !config.ethics.statement) blockers.push("ETHICS_ARRANGEMENT_NOT_SUPPLIED");
  if (config.ethics.arrangement !== "NOT_SUPPLIED" && !config.ethics.researcherConfirmed) blockers.push("ETHICS_NOT_CONFIRMED_BY_RESEARCHER");
  if (["COMMITTEE_APPROVED", "COMMITTEE_EXEMPT"].includes(config.ethics.arrangement) && !(config.ethics.body && config.ethics.reference)) blockers.push("COMMITTEE_REFERENCE_MISSING");
  for (const v of [config.ethics.statement, config.ethics.body, config.ethics.reference, config.dataRetention, config.dataAccess, config.withdrawalProcedure, config.principalInvestigator, config.institution]) {
    if (v && PLACEHOLDER.test(v)) {
      blockers.push("PLACEHOLDER_TEXT_PRESENT");
      break;
    }
  }
  return { config, blockers, sha256: sha256Hex(stableJSON(config)) };
}

// pilot/consent-text.mjs
var CONSENT_TEMPLATE_VERSION = "PM-CONSENT-5";
function buildConsentDocument(researcher = {}) {
  const r = researcher, e = r.ethics || {};
  const duration = r.estimatedDurationMinutes ? `about ${r.estimatedDurationMinutes} minutes (${r.durationEstimateBasis || "researcher estimate"})` : "a duration the researcher has not yet confirmed";
  const arrangement = {
    SUPERVISOR_HANDLED: "Ethics arrangement: handled by the supervising researcher as described below.",
    COMMITTEE_APPROVED: `Ethics review: approved${e.body ? ` by ${e.body}` : ""}${e.reference ? ` (reference ${e.reference})` : ""}.`,
    COMMITTEE_EXEMPT: `Ethics review: exempt${e.body ? ` per ${e.body}` : ""}${e.reference ? ` (reference ${e.reference})` : ""}.`,
    NOT_SUPPLIED: "ETHICS INFORMATION NOT YET SUPPLIED BY THE RESEARCHER. This page may only be used for technical testing."
  }[e.arrangement || "NOT_SUPPLIED"];
  return {
    version: CONSENT_TEMPLATE_VERSION,
    title: r.studyTitle || "Political Mirror pilot study",
    researcherLine: `${r.principalInvestigator ? `Researcher: ${r.principalInvestigator}` : "Researcher: not yet named in the researcher configuration"}${r.institution ? ` \xB7 ${r.institution}` : ""} \xB7 Contact: ${r.contactEmail || ""}`,
    sections: [
      { heading: "What this study is about", paragraphs: ["This research explores how people make political judgments before and after playing a fictional political career and reading feedback about it. All characters, parties and events are fictional. The results are intended for a conference pilot paper and research presentations."] },
      { heading: "What you will do", paragraphs: [`You will judge three sets of eight short fictional cases about officials accused of misconduct, play one fictional political career in which you make public decisions and private judgments, read feedback about your play, and answer optional questions about your experience. Expect ${duration}. You may pause and return on this browser. Some material concerns misconduct, accusations and political disagreement; the tasks can be tiring and you may take breaks.`] },
      { heading: "Voluntary participation and your right to stop", paragraphs: ["Taking part is voluntary. You may stop at any time, without giving a reason and without any disadvantage, by choosing \u201CStop participation\u201D. When the server confirms your stop request, the study deletes your submitted answers, game records, predictions and questionnaire from its active database. Only a minimal coded withdrawal record remains to prevent reuse of your place and to provide the debrief. If the connection fails, the page will say that deletion has not yet been confirmed; please retry or email the researcher with your session code. If you stop after the feedback has been shown, an explanation of what that feedback was stays available on the same browser. Closing the page or losing your connection does not end your participation; you can continue later on the same browser."] },
      { heading: "Your data and privacy", paragraphs: [
        "We record your case judgments, game choices and private in-game judgments, response and elapsed times, career outcomes, the feedback shown to you, questionnaire answers, and technical and completion records under a randomly generated session code. We do not ask for your name; please do not enter your name or other identifying details in free-text answers. The records are pseudonymous (linked to a code, not to your identity), not absolutely anonymous. The study is hosted on Cloudflare, whose platform processes ordinary connection metadata to deliver the service; the study application itself does not store IP addresses or browser identifiers with your responses.",
        `Data retention: ${r.dataRetention || "not yet specified by the researcher"}.`,
        `Who can access the data: ${r.dataAccess || "not yet specified by the researcher"}.`,
        `Withdrawal of data: ${r.withdrawalProcedure || "not yet specified by the researcher"}`,
        "Deletion from the active study database does not instantly erase copies previously downloaded by the research team or Cloudflare recovery history. The researcher handles those copies according to the stated withdrawal arrangement and excludes withdrawn responses from further analysis. Previously published aggregate findings cannot be retrospectively separated into individual records."
      ] },
      { heading: "Feedback", paragraphs: ["Different participants receive different feedback. Some feedback is drawn from the participant\u2019s own recorded play, while some uses a fixed comparison profile. The precise assignment is explained at the end of the study. These profiles and any predictions are research tools, not validated psychological diagnoses, and nothing in this study is advice about real political choices."] },
      { heading: "Ethics and contact", paragraphs: [arrangement, e.statement || "", `Questions or concerns: ${r.contactEmail || ""}.`].filter(Boolean) }
    ],
    confirmations: [
      { id: "adult", text: "I confirm that I am 18 years old or older." },
      { id: "english", text: "I can comfortably read the English instructions, cases and game." },
      { id: "informed", text: "I have read the information above and I understand that taking part is voluntary and that I can stop at any time." },
      { id: "agreed", text: "I agree to take part in this study and to the described use of my responses." }
    ]
  };
}
function consentDocumentSha256(researcher) {
  return sha256Hex(stableJSON(buildConsentDocument(researcher)));
}

// pilot-cloud/auto-storage.mjs
var STORAGE_SCHEMA = 6;
var PRODUCT = "political-mirror-autostorage";
function fail(code, status = 503) {
  const e = new Error(code);
  e.code = code;
  e.status = status;
  throw e;
}
function check(ok, code, status) {
  if (!ok) fail(code, status);
}
function message(e) {
  return [e, e?.cause, e?.cause?.cause].filter(Boolean).map((x) => String(x.message || x)).join(" | ");
}
async function readDeployment(env, url) {
  const assetURL = new URL("/study-deployment.json", url);
  const response = await env.ASSETS.fetch(new Request(assetURL, { method: "GET" }));
  check(response.ok, "DEPLOYMENT_SETTINGS_FILE_MISSING");
  const text2 = await response.text();
  check(text2.length < 1e5, "DEPLOYMENT_SETTINGS_TOO_LARGE");
  let m;
  try {
    m = JSON.parse(text2);
  } catch {
    fail("DEPLOYMENT_SETTINGS_INVALID_JSON");
  }
  check(m && m.schema === "pm-autostorage-deployment/1", "DEPLOYMENT_SETTINGS_WRONG_FORMAT");
  check(m.releaseVersion === "0.38.3-storage.2", "DEPLOYMENT_RELEASE_MISMATCH");
  check(Number.isSafeInteger(m.revision) && m.revision > 0, "DEPLOYMENT_REVISION_INVALID");
  check(["TEST", "HUMAN", "CLOSED"].includes(m.mode), "DEPLOYMENT_MODE_INVALID");
  const loaded = m.researcherConfig == null ? null : loadResearcherConfig(m.researcherConfig);
  if (loaded) check(loaded.blockers.length === 0, "RESEARCHER_INFORMATION_INCOMPLETE: " + loaded.blockers.join(", "));
  else check(m.mode === "CLOSED", "RESEARCHER_INFORMATION_REQUIRED_BEFORE_ENROLLMENT");
  const removals = m.removeSessionIds ?? [];
  check(Array.isArray(removals) && removals.length <= 20 && removals.every((x) => typeof x === "string" && /^[a-f0-9-]{36}$/.test(x)), "INVALID_REMOVAL_SESSION_IDS");
  check(removals.length === 0 || m.mode === "CLOSED", "CLOSE_RECRUITMENT_FOR_DEPLOYMENT_REMOVAL");
  const document = loaded ? buildConsentDocument(loaded.config) : null;
  const content = { schema: m.schema, releaseVersion: m.releaseVersion, revision: m.revision, mode: m.mode, researcherConfig: loaded?.config ?? null, removeSessionIds: [...new Set(removals)].sort() };
  return { revision: m.revision, mode: m.mode, loaded, document, removals: content.removeSessionIds, digest: sha256Hex(stableJSON(content)) };
}
async function inspectSchema(db) {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").first();
  if (!table) return null;
  const version = await db.prepare("SELECT version FROM schema_version WHERE id=1").first();
  check(version?.version === STORAGE_SCHEMA, "USE_A_NEW_DEDICATED_DATABASE: existing schema is not auto-storage version 6");
  const marker = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_installation'").first();
  check(marker, "DATABASE_OWNERSHIP_MARKER_MISSING");
  const identity = await db.prepare("SELECT product,schema_version FROM storage_installation WHERE id=1").first();
  check(identity?.product === PRODUCT && identity.schema_version === STORAGE_SCHEMA, "DATABASE_OWNERSHIP_MISMATCH");
  return version;
}
async function initialize(db) {
  let found = await inspectSchema(db);
  if (found) return found;
  const others = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'").all();
  if (others.results.length) {
    found = await inspectSchema(db);
    if (found) return found;
    fail("DATABASE_NOT_EMPTY: create a new dedicated D1; existing data was not changed");
  }
  try {
    await db.batch(schema_statements_default.map((sql) => db.prepare(sql)));
  } catch (e) {
    fail("AUTOMATIC_DATABASE_SETUP_FAILED: " + message(e).slice(0, 170));
  }
  return await inspectSchema(db);
}
async function applyDeployment(db, m) {
  let state = await db.prepare("SELECT revision,manifest_sha256 FROM deployment_state WHERE id=1").first();
  check(state, "DEPLOYMENT_STATE_MISSING");
  if (state.revision > m.revision) fail("OLD_DEPLOYMENT: open the current production URL; no data was changed", 409);
  if (state.revision === m.revision) {
    check(state.manifest_sha256 === m.digest, "SAME_REVISION_DIFFERENT_SETTINGS", 409);
    return;
  }
  const at = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await db.prepare(`UPDATE deployment_state SET revision=?,manifest_sha256=?,config_sha256=?,
   consent_text_sha256=?,researcher_config_json=?,consent_document_json=?,mode=?,updated_at=?,removal_ids_json=?
   WHERE id=1 AND revision<?`).bind(
      m.revision,
      m.digest,
      m.loaded?.sha256 ?? null,
      m.loaded ? consentDocumentSha256(m.loaded.config) : null,
      m.loaded ? JSON.stringify(m.loaded.config) : null,
      m.document ? JSON.stringify(m.document) : null,
      m.mode,
      at,
      JSON.stringify(m.removals),
      m.revision
    ).run();
  } catch (e) {
    if (/CONFIG_LOCKED_AFTER_FIRST_CONSENT/.test(message(e))) fail("STUDY_INFORMATION_LOCKED: use the original saved study details", 409);
    if (/CANNOT_REOPEN_TEST_MODE/.test(message(e))) fail("CANNOT_CHANGE_HUMAN_STUDY_BACK_TO_TEST", 409);
    throw e;
  }
  state = await db.prepare("SELECT revision,manifest_sha256 FROM deployment_state WHERE id=1").first();
  check(state?.revision === m.revision && state?.manifest_sha256 === m.digest, "DEPLOYMENT_CHANGED_RETRY_CURRENT_URL", 409);
}
async function ensureStorage(env, url) {
  const deployment = await readDeployment(env, url);
  const schema = await initialize(env.DB);
  await applyDeployment(env.DB, deployment);
  return schema;
}

// pilot/consent-validator.mjs
var CONSENT_CONFIRMATIONS = Object.freeze(["adult", "english", "informed", "agreed"]);
var HEX64 = /^[a-f0-9]{64}$/;
function validateConsentSubmission(input, { researcherConfigSha256, consentTextSha256 } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("CONSENT_OBJECT_REQUIRED");
  const allowed = /* @__PURE__ */ new Set([...CONSENT_CONFIRMATIONS, "eligible", "researcherConfigSha256", "consentTextSha256", "ethicsReference", "studyTitle"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`CONSENT_UNKNOWN_FIELD:${key}`);
  for (const key of CONSENT_CONFIRMATIONS) {
    if (!(key in input) || input[key] === void 0) throw new Error(`CONSENT_CONFIRMATION_MISSING:${key}`);
    if (typeof input[key] !== "boolean") throw new Error(`CONSENT_CONFIRMATION_NOT_BOOLEAN:${key}`);
    if (input[key] !== true) throw new Error(`CONSENT_CONFIRMATION_NOT_TRUE:${key}`);
  }
  if ("eligible" in input && input.eligible !== true) throw new Error("CONSENT_CONFIRMATION_NOT_TRUE:eligible");
  if (!HEX64.test(input.researcherConfigSha256 || "")) throw new Error("CONSENT_CONFIG_HASH_REQUIRED");
  if (!HEX64.test(input.consentTextSha256 || "")) throw new Error("CONSENT_TEXT_HASH_REQUIRED");
  if (researcherConfigSha256 && input.researcherConfigSha256 !== researcherConfigSha256) throw new Error("CONSENT_CONFIG_MISMATCH");
  if (consentTextSha256 && input.consentTextSha256 !== consentTextSha256) throw new Error("CONSENT_CONFIG_MISMATCH");
  if (input.ethicsReference != null && (typeof input.ethicsReference !== "string" || input.ethicsReference.length > 200)) throw new Error("CONSENT_INVALID_ETHICS_REFERENCE");
  if (input.studyTitle != null && (typeof input.studyTitle !== "string" || input.studyTitle.length > 300)) throw new Error("CONSENT_INVALID_STUDY_TITLE");
  return {
    adult: true,
    english: true,
    informed: true,
    agreed: true,
    eligible: true,
    researcherConfigSha256: input.researcherConfigSha256,
    consentTextSha256: input.consentTextSha256,
    ethicsReference: input.ethicsReference ?? null,
    studyTitle: input.studyTitle ?? null
  };
}
function consentRecordIsComplete(consent) {
  return !!consent && typeof consent === "object" && [...CONSENT_CONFIRMATIONS, "eligible"].every((k) => consent[k] === true) && HEX64.test(consent.researcherConfigSha256 || "") && HEX64.test(consent.consentTextSha256 || "") && typeof consent.at === "string";
}

// pilot/cases.mjs
var CASE_BANK_VERSION = "pm-parallel-cases/1.0.0";
var DIMENSIONS = Object.freeze([
  "evidenceSensitivity",
  "partisanSymmetry",
  "crowdSusceptibility",
  "deniabilitySusceptibility"
]);
var JUDGMENT_PROMPT = "How likely is it that the official deliberately misused their public position in the way alleged?";
var VOTE_PROMPT = "If these were your only two options, would you retain this official or replace them with an otherwise comparable candidate?";
var FEATURE_ROWS = [
  ["E_LOW", "evidenceSensitivity", "LOW", { evidence: 0.2, partisan: 0, crowd: 0, deniability: 0 }],
  ["P_OWN", "partisanSymmetry", "PLAYER_SIDE", { evidence: 0.45, partisan: -0.5, crowd: 0, deniability: 0 }],
  ["C_HIGH", "crowdSusceptibility", "CROWD_HIGH", { evidence: 0.45, partisan: 0, crowd: 0.5, deniability: 0 }],
  ["D_HIGH", "deniabilitySusceptibility", "DEN_HIGH", { evidence: 0.45, partisan: 0, crowd: 0, deniability: 0.5 }],
  ["E_HIGH", "evidenceSensitivity", "HIGH", { evidence: 0.7, partisan: 0, crowd: 0, deniability: 0 }],
  ["P_OPP", "partisanSymmetry", "OPPOSING_SIDE", { evidence: 0.45, partisan: 0.5, crowd: 0, deniability: 0 }],
  ["C_LOW", "crowdSusceptibility", "CROWD_LOW", { evidence: 0.45, partisan: 0, crowd: -0.5, deniability: 0 }],
  ["D_LOW", "deniabilitySusceptibility", "DEN_LOW", { evidence: 0.45, partisan: 0, crowd: 0, deniability: -0.5 }]
];
var TEXTS = {
  A: [
    ["The delivery van", "Councillor Lena Voss is accused of using a city delivery van to move stock for her private furniture shop. An anonymous online post says a van was seen near the shop. The photograph is blurred, the number plate cannot be read, and no journey record has been obtained. Voss denies arranging any private deliveries. No party affiliation or public reaction is reported."],
    ["The festival stall", "Imagine that Councillor Ravi Sen belongs to the political party whose policies you generally prefer. Sen is accused of moving a campaign volunteer ahead of other applicants for a city festival stall. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Sen says an eligibility review explains the change. No review record or additional evidence is available."],
    ["The evening hall booking", "Councillor Mara Cole is accused of arranging free use of the town hall for a friend\u2019s private ticketed talk. A booking entry lists Cole as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Cole denies arranging free access. Thousands of people have reposted this same entry with angry comments; none provides new evidence. No party affiliation is reported."],
    ["The overtime memo", "A scanned memo appears to show Councillor Joel Ward directing paid city staff to prepare campaign leaflets. If authentic, the instruction would be a misuse of public resources. Ward says his signature was copied onto a draft he never approved. Only a forwarded scan is available, and the original has not been located or independently authenticated. No party affiliation or public reaction is reported."],
    ["The printing order", "Councillor Tessa Reed is accused of using the city printing service for her private art sale. An independently checked order record identifies Reed, specifies the private sale flyers, and charges the job to the city. In a verified message, Reed acknowledges knowingly using the city account for this personal expense. No party affiliation or public reaction is reported."],
    ["The market stall", "Imagine that Councillor Owen Park belongs to the political party whose policies you generally oppose. Park is accused of moving a campaign volunteer ahead of other applicants for a city market stall. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Park says an eligibility review explains the change. No review record or additional evidence is available."],
    ["The afternoon hall booking", "Councillor Nia Bell is accused of arranging free use of the town hall for a friend\u2019s private ticketed lecture. A booking entry lists Bell as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Bell denies arranging free access. A local reporter has filed the entry, but there has been no public circulation or reaction. No party affiliation is reported."],
    ["The staffing memo", "A signed memo appears to show Councillor Evan Moss directing paid city staff to prepare campaign posters. If authentic, the instruction would be a misuse of public resources. Moss says his signature was copied onto a draft he never approved. The original is available, and two independent document examiners confirm the signature and find no alterations. No party affiliation or public reaction is reported."]
  ],
  B: [
    ["The surveying kit", "Councillor Iris Dale is accused of taking city surveying equipment for work on her private orchard. An anonymous online post says equipment was seen near the orchard. The photograph is blurred, the equipment label cannot be read, and no checkout record has been obtained. Dale denies arranging any private use. No party affiliation or public reaction is reported."],
    ["The west marina berth", "Imagine that Councillor Amir Lake belongs to the political party whose policies you generally prefer. Lake is accused of moving a campaign volunteer ahead of other applicants for a city marina berth. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Lake says an eligibility review explains the change. No review record or additional evidence is available."],
    ["The morning pool lane", "Councillor Rosa Finch is accused of arranging free use of a municipal pool lane for a friend\u2019s private paid coaching. A booking entry lists Finch as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Finch denies arranging free access. Thousands of people have reposted this same entry with angry comments; none provides new evidence. No party affiliation is reported."],
    ["The mailing instruction", "A scanned instruction appears to show Councillor Milo Stone directing paid city staff to send campaign mailings. If authentic, the instruction would be a misuse of public resources. Stone says his signature was copied onto a draft he never approved. Only a forwarded scan is available, and the original has not been located or independently authenticated. No party affiliation or public reaction is reported."],
    ["The translation order", "Councillor Anya Frost is accused of using the city translation service for her private cookbook. An independently checked order record identifies Frost, specifies the private cookbook text, and charges the job to the city. In a verified message, Frost acknowledges knowingly using the city account for this personal expense. No party affiliation or public reaction is reported."],
    ["The east marina berth", "Imagine that Councillor Leo Brook belongs to the political party whose policies you generally oppose. Brook is accused of moving a campaign volunteer ahead of other applicants for a city marina berth. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Brook says an eligibility review explains the change. No review record or additional evidence is available."],
    ["The evening pool lane", "Councillor Hana Wells is accused of arranging free use of a municipal pool lane for a friend\u2019s private paid training. A booking entry lists Wells as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Wells denies arranging free access. A local reporter has filed the entry, but there has been no public circulation or reaction. No party affiliation is reported."],
    ["The call-list instruction", "A signed instruction appears to show Councillor Noah Field directing paid city staff to make campaign calls. If authentic, the instruction would be a misuse of public resources. Field says his signature was copied onto a draft he never approved. The original is available, and two independent document examiners confirm the signature and find no alterations. No party affiliation or public reaction is reported."]
  ],
  C: [
    ["The recording studio", "Councillor Ada Marsh is accused of using the city recording studio for her private advertising business. An anonymous online post says she was seen near the studio. The photograph is blurred, the entrance sign cannot be read, and no booking record has been obtained. Marsh denies arranging any private sessions. No party affiliation or public reaction is reported."],
    ["The north parking space", "Imagine that Councillor Sami Glen belongs to the political party whose policies you generally prefer. Glen is accused of moving a campaign volunteer ahead of other applicants for a city overnight parking space. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Glen says an eligibility review explains the change. No review record or additional evidence is available."],
    ["The first telescope booking", "Councillor Clara Pine is accused of arranging free use of a municipal telescope for a friend\u2019s private paid tour. A booking entry lists Pine as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Pine denies arranging free access. Thousands of people have reposted this same entry with angry comments; none provides new evidence. No party affiliation is reported."],
    ["The dispatch instruction", "A scanned instruction appears to show Councillor Theo Vale directing paid city staff to deliver campaign newsletters. If authentic, the instruction would be a misuse of public resources. Vale says his signature was copied onto a draft he never approved. Only a forwarded scan is available, and the original has not been located or independently authenticated. No party affiliation or public reaction is reported."],
    ["The storage order", "Councillor Mira Hart is accused of using the city warehouse for her private catering stock. An independently checked order record identifies Hart, specifies the private business supplies, and charges storage to the city. In a verified message, Hart acknowledges knowingly using the city account for this personal expense. No party affiliation or public reaction is reported."],
    ["The south parking space", "Imagine that Councillor Luca Birch belongs to the political party whose policies you generally oppose. Birch is accused of moving a campaign volunteer ahead of other applicants for a city overnight parking space. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Birch says an eligibility review explains the change. No review record or additional evidence is available."],
    ["The second telescope booking", "Councillor Esme West is accused of arranging free use of a municipal telescope for a friend\u2019s private paid visit. A booking entry lists West as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. West denies arranging free access. A local reporter has filed the entry, but there has been no public circulation or reaction. No party affiliation is reported."],
    ["The packing instruction", "A signed instruction appears to show Councillor Finn Grove directing paid city staff to pack campaign welcome letters. If authentic, the instruction would be a misuse of public resources. Grove says his signature was copied onto a draft he never approved. The original is available, and two independent document examiners confirm the signature and find no alterations. No party affiliation or public reaction is reported."]
  ]
};
function freezeDeep(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
var FORMS = freezeDeep(Object.fromEntries(Object.entries(TEXTS).map(([form, rows]) => [
  form,
  rows.map(([title, text2], index) => {
    const [slot, dimension, level, features] = FEATURE_ROWS[index];
    return {
      id: `${form}_${slot}`,
      caseId: `${form}_${slot}`,
      form,
      slot,
      dimension,
      pairId: `${form}_${dimension}`,
      level,
      title,
      text: text2,
      features: { ...features },
      prompt: JUDGMENT_PROMPT,
      votePrompt: VOTE_PROMPT,
      caseBankVersion: CASE_BANK_VERSION
    };
  })
])));
function getCases(form) {
  if (!Object.hasOwn(FORMS, form)) throw new Error(`Unknown parallel form: ${form}`);
  return FORMS[form];
}
function getCase(caseId) {
  for (const rows of Object.values(FORMS)) {
    const item = rows.find((row) => row.id === caseId);
    if (item) return item;
  }
  throw new Error(`Unknown voter-judgment case: ${caseId}`);
}

// pilot/study.mjs
var STUDY_VERSION = "0.38.3-pilot.1";
var CONSENT_VERSION = "PM-CONSENT-5";
var STAGES = ["CONSENT", "T0", "GAME", "PREDICTION", "T1", "MIRROR", "T2", "SURVEY", "DEBRIEF", "COMPLETE"];
var insist = (condition, message2) => {
  if (!condition) throw new Error(message2);
};
var eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var validDate = (x) => typeof x === "string" && Number.isFinite(Date.parse(x));
var validScore = (x) => Number.isInteger(x) && x >= 0 && x <= 100;
function formFor(s, block) {
  return s.assignment.formOrder[["T0", "T1", "T2"].indexOf(block)];
}
function validateGameSnapshot(s, g) {
  insist(g?.schema === "political-mirror-study-game/1", "Missing game snapshot");
  insist(g.sessionId === s.sessionId && g.arm === s.assignment.arm, "Game identity/arm changed");
  insist(g.spec?.testMode === "natural" && g.spec?.agentCount === 700, "Unexpected game configuration");
  insist(Array.isArray(g.transcript) && g.canonicalState && typeof g.canonicalHash === "string", "Incomplete canonical snapshot");
  insist(g.telemetry && typeof g.telemetry === "object", "Game telemetry missing");
  if (s.game) {
    insist(g.transcript.length >= s.game.transcript.length, "Canonical actions cannot disappear");
    insist(eq(g.transcript.slice(0, s.game.transcript.length), s.game.transcript), "Canonical history changed");
    if (s.stage !== "GAME") insist(eq(g.canonicalState, s.game.canonicalState) && g.canonicalHash === s.game.canonicalHash, "Feedback/survey must not alter canonical state");
  }
}
function validateStudyState(s, { predictionCommitted } = {}) {
  insist(s?.schema === "political-mirror-study/1" && s.studyVersion === STUDY_VERSION, "Unknown study schema/version");
  insist(typeof s.sessionId === "string" && s.participantId === s.sessionId, "Participant/session mismatch");
  insist(s.coreGame?.version === "0.37.2" && /^[a-f0-9]{64}$/.test(s.coreGame.buildHash) && /^[a-f0-9]{64}$/.test(s.coreGame.sourceManifestHash), "Frozen build identity missing");
  insist(s.consentVersion === CONSENT_VERSION, "Consent version mismatch");
  insist(["TRUE", "SHUFFLED"].includes(s.assignment?.arm), "Unknown arm");
  insist(["ABC", "BCA", "CAB"].includes(s.assignment?.formOrder?.join("")), "Unknown parallel form order");
  insist([...STAGES, "WITHDRAWN"].includes(s.stage), "Unknown stage");
  insist(s.status === ({ "COMPLETE": "complete", "WITHDRAWN": "withdrawn" }[s.stage] || "in_progress"), "Status/stage mismatch");
  insist(validDate(s.timestamps?.createdAt) && validDate(s.timestamps?.updatedAt), "Invalid timestamps");
  insist(Array.isArray(s.events) && Array.isArray(s.technicalErrors), "Audit arrays missing");
  s.events.forEach((e, i) => insist(e.seq === i + 1 && validDate(e.at), "Invalid event sequence"));
  if (!["CONSENT", "WITHDRAWN"].includes(s.stage)) insist(consentRecordIsComplete(s.consent) && s.consent.version === CONSENT_VERSION, "Active consent required");
  for (const block of ["T0", "T1", "T2"]) {
    const rows = s.responses?.[block];
    insist(Array.isArray(rows) && rows.length <= 8, `Invalid ${block} rows`);
    const cases = getCases(formFor(s, block));
    rows.forEach((r, i) => insist(r.caseId === cases[i].id && validScore(r.score) && ["RETAIN", "REPLACE"].includes(r.vote) && validDate(r.presentedAt) && validDate(r.answeredAt) && Date.parse(r.answeredAt) >= Date.parse(r.presentedAt) && Number.isFinite(r.rtMs) && r.rtMs === Date.parse(r.answeredAt) - Date.parse(r.presentedAt), `Invalid ${block} response ${i}`));
  }
  if (s.stage === "CONSENT") insist(Object.values(s.responses).every((rows) => rows.length === 0) && !s.presentation && !s.game && !s.prediction && Object.keys(s.questionnaire).length === 0, "No research responses before consent");
  if (s.stage === "T0") insist(!s.game && !s.prediction, "Gameplay cannot precede completed T0");
  if (Object.values(s.responses).some((rows) => rows.length) || s.game) insist(s.consent?.agreed === true && s.consent?.eligible === true && s.consent?.adult === true, "Research data require prior consent");
  const ix = STAGES.indexOf(s.stage);
  if (ix >= 2) insist(s.responses.T0.length === 8, "T0 incomplete");
  if (ix >= 5) insist(s.responses.T1.length === 8, "T1 incomplete");
  if (ix >= 7) insist(s.responses.T2.length === 8, "T2 incomplete");
  if (ix < 4 && s.stage !== "WITHDRAWN") insist(s.responses.T1.length === 0, "Premature T1 data");
  if (ix < 6 && s.stage !== "WITHDRAWN") insist(s.responses.T2.length === 0, "Premature T2 data");
  if (s.presentation) {
    insist(["T0", "T1", "T2"].includes(s.stage) && s.presentation.block === s.stage, "Invalid item presentation");
    insist(s.presentation.caseId === getCases(formFor(s, s.stage))[s.responses[s.stage].length]?.id && validDate(s.presentation.presentedAt), "Wrong presented item");
  }
  if (ix >= 3) insist(s.game?.canonicalState?.phase === "MINI_MIRROR", "Missing completed canonical game");
  if (s.game) validateGameSnapshot({ ...s, game: null }, s.game);
  if (ix >= 4 || s.responses.T1.length || s.responses.T2.length || s.prediction) {
    const p = s.prediction;
    insist(p && s.predictionReceipt?.predictionSha256 && validDate(s.predictionReceipt.committedAt), "Missing committed prediction");
    insist(predictionCommitted !== false, "Server prediction not committed");
    insist(p.participantId === s.participantId && p.sessionId === s.sessionId && p.studyVersion === s.studyVersion && p.coreHash === s.coreGame.buildHash, "Prediction identity mismatch");
    insist(p.form === formFor(s, "T1") && validDate(p.timestamp), "Prediction form/timestamp mismatch");
    insist(Array.isArray(p.predictions) && p.predictions.length === 8 && p.modelState, "Incomplete prediction payload");
    p.predictions.forEach((r, i) => {
      insist(r.caseId === getCases(p.form)[i].id, "Wrong prediction case");
      for (const m of ["M0", "M1", "M2", "M3"]) insist(Number.isFinite(r[m]?.predictedScore) && r[m].predictedScore >= 0 && r[m].predictedScore <= 100, "Invalid prediction score");
    });
    const commitEvent = s.events.find((e) => e.type === "PREDICTION_COMMITTED");
    const firstT1 = s.events.find((e) => e.type === "ITEM_PRESENTED" && e.block === "T1");
    insist(commitEvent, "Prediction commit event missing");
    if (firstT1) insist(firstT1.seq > commitEvent.seq, "T1 presentation precedes prediction commitment");
  }
  return true;
}
function validateStudyTransition(previous, next, options = {}) {
  validateStudyState(next, options);
  if (!previous) return true;
  for (const field of ["schema", "studyVersion", "coreGame", "consentVersion", "participantId", "sessionId", "assignment"])
    insist(eq(previous[field], next[field]), `Immutable field changed: ${field}`);
  if (previous.consent) insist(eq(previous.consent, next.consent), "Consent changed");
  for (const b2 of ["T0", "T1", "T2"]) insist(eq(previous.responses[b2], next.responses[b2].slice(0, previous.responses[b2].length)), "A saved response changed");
  insist(eq(previous.events, next.events.slice(0, previous.events.length)), "Audit history changed");
  insist(eq(previous.technicalErrors, next.technicalErrors.slice(0, previous.technicalErrors.length)), "Error history changed");
  if (previous.prediction) insist(eq(previous.prediction, next.prediction) && eq(previous.predictionReceipt, next.predictionReceipt), "Prediction lock changed");
  if (previous.game && next.game) validateGameSnapshot(previous, next.game);
  const a = STAGES.indexOf(previous.stage), b = STAGES.indexOf(next.stage);
  if (next.stage !== "WITHDRAWN") insist(previous.stage !== "WITHDRAWN" && b >= a && b <= a + 1, "Illegal study transition");
  if (previous.stage === "COMPLETE") insist(next.stage === "COMPLETE", "Completed session reopened");
  return true;
}

// src/det-math.mjs
var bits = new DataView(new ArrayBuffer(8));
function highWord(x) {
  bits.setFloat64(0, x);
  return bits.getUint32(0);
}
function lowWord(x) {
  bits.setFloat64(0, x);
  return bits.getUint32(4);
}
function fromWords(hi, lo) {
  bits.setUint32(0, hi >>> 0);
  bits.setUint32(4, lo >>> 0);
  return bits.getFloat64(0);
}
function withHighWord(x, hi) {
  bits.setFloat64(0, x);
  bits.setUint32(0, hi >>> 0);
  return bits.getFloat64(0);
}
var HUGE = 1e300;
var TINY = 1e-300;
var LN2_HI = 0.6931471803691238;
var LN2_LO = 19082149292705877e-26;
var INV_LN2 = 1.4426950408889634;
var O_THRESHOLD = 709.782712893384;
var U_THRESHOLD = -745.1332191019411;
var TWO_M1000 = 9332636185032189e-317;
var TWO_P1023 = 898846567431158e293;
var TWO54 = 18014398509481984;
var EXP_P1 = 0.16666666666666602;
var EXP_P2 = -0.0027777777777015593;
var EXP_P3 = 6613756321437934e-20;
var EXP_P4 = -16533902205465252e-22;
var EXP_P5 = 41381367970572385e-24;
function detExp(x) {
  let hx = highWord(x);
  const xsb = hx >>> 31 & 1;
  hx &= 2147483647;
  if (hx >= 1082535490) {
    if (hx >= 2146435072) {
      if ((hx & 1048575 | lowWord(x)) !== 0) return x + x;
      return xsb === 0 ? x : 0;
    }
    if (x > O_THRESHOLD) return HUGE * HUGE;
    if (x < U_THRESHOLD) return TWO_M1000 * TWO_M1000;
  }
  let k = 0, hi = 0, lo = 0;
  if (hx > 1071001154) {
    if (hx < 1072734898) {
      hi = x - (xsb === 0 ? LN2_HI : -LN2_HI);
      lo = xsb === 0 ? LN2_LO : -LN2_LO;
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(INV_LN2 * x + (xsb === 0 ? 0.5 : -0.5));
      const t2 = k;
      hi = x - t2 * LN2_HI;
      lo = t2 * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 1043333120) {
    return 1 + x;
  }
  const t = x * x;
  const c = x - t * (EXP_P1 + t * (EXP_P2 + t * (EXP_P3 + t * (EXP_P4 + t * EXP_P5))));
  if (k === 0) return 1 - (x * c / (c - 2) - x);
  const y = 1 - (lo - x * c / (2 - c) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2 * TWO_P1023;
    return y * fromWords(1023 + k << 20, 0);
  }
  return y * fromWords(1023 + (k + 1e3) << 20, 0) * TWO_M1000;
}
var EM1_Q1 = -0.03333333333333313;
var EM1_Q2 = 0.0015873015872548146;
var EM1_Q3 = -793650757867488e-19;
var EM1_Q4 = 4008217827329362e-21;
var EM1_Q5 = -20109921818362437e-23;
function detExpm1(x) {
  let hx = highWord(x);
  const negative = (hx & 2147483648) !== 0;
  hx &= 2147483647;
  if (hx >= 1078159482) {
    if (hx >= 1082535490) {
      if (hx >= 2146435072) {
        if ((hx & 1048575 | lowWord(x)) !== 0) return x + x;
        return negative ? -1 : x;
      }
      if (x > O_THRESHOLD) return HUGE * HUGE;
    }
    if (negative) return TINY - 1;
  }
  let k = 0, hi, lo, c = 0;
  if (hx > 1071001154) {
    if (hx < 1072734898) {
      if (!negative) {
        hi = x - LN2_HI;
        lo = LN2_LO;
        k = 1;
      } else {
        hi = x + LN2_HI;
        lo = -LN2_LO;
        k = -1;
      }
    } else {
      k = Math.trunc(INV_LN2 * x + (negative ? -0.5 : 0.5));
      const t2 = k;
      hi = x - t2 * LN2_HI;
      lo = t2 * LN2_LO;
    }
    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 1016070144) {
    return x;
  }
  const hfx = 0.5 * x;
  const hxs = x * hfx;
  const r1 = 1 + hxs * (EM1_Q1 + hxs * (EM1_Q2 + hxs * (EM1_Q3 + hxs * (EM1_Q4 + hxs * EM1_Q5))));
  let t = 3 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6 - x * t));
  if (k === 0) return x - (x * e - hxs);
  const twopk = fromWords(1072693248 + (k << 20), 0);
  e = x * (e - c) - c;
  e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) {
    if (x < -0.25) return -2 * (e - (x + 0.5));
    return 1 + 2 * (x - e);
  }
  if (k <= -2 || k > 56) {
    let y2 = 1 - (e - x);
    y2 = k === 1024 ? y2 * 2 * TWO_P1023 : y2 * twopk;
    return y2 - 1;
  }
  let y;
  if (k < 20) {
    t = fromWords(1072693248 - (2097152 >> k), 0);
    y = t - (e - x);
    y = y * twopk;
  } else {
    t = fromWords(1023 - k << 20, 0);
    y = x - (e + t);
    y += 1;
    y = y * twopk;
  }
  return y;
}
function detTanh(x) {
  const jx = highWord(x) | 0;
  const ix = jx & 2147483647;
  if (ix >= 2146435072) return jx >= 0 ? 1 / x + 1 : 1 / x - 1;
  let z;
  if (ix < 1077280768) {
    if (ix < 1043333120) return x;
    if (ix >= 1072693248) {
      const t = detExpm1(2 * Math.abs(x));
      z = 1 - 2 / (t + 2);
    } else {
      const t = detExpm1(-2 * Math.abs(x));
      z = -t / (t + 2);
    }
  } else {
    z = 1 - TINY;
  }
  return jx >= 0 ? z : -z;
}
var LG1 = 0.6666666666666735;
var LG2 = 0.3999999999940942;
var LG3 = 0.2857142874366239;
var LG4 = 0.22222198432149784;
var LG5 = 0.1818357216161805;
var LG6 = 0.15313837699209373;
var LG7 = 0.14798198605116586;
function detLog(x) {
  let hx = highWord(x) | 0;
  const lx = lowWord(x);
  let k = 0;
  if (hx < 1048576) {
    if ((hx & 2147483647 | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = highWord(x) | 0;
  }
  if (hx >= 2146435072) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 1048575;
  const i = hx + 614244 & 1048576;
  x = withHighWord(x, hx | i ^ 1072693248);
  k += i >> 20;
  const f = x - 1;
  if ((1048575 & 2 + hx) < 3) {
    if (f === 0) {
      if (k === 0) return 0;
      return k * LN2_HI + k * LN2_LO;
    }
    const R2 = f * f * (0.5 - 0.3333333333333333 * f);
    if (k === 0) return f - R2;
    return k * LN2_HI - (R2 - k * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const i2 = hx - 398458 | 440401 - hx;
  if (i2 > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return k * LN2_HI - (s * (f - R) - k * LN2_LO - f);
}
var detSquare = (v) => v * v;

// src/engine.mjs
var rotl = (x, k) => (x << k | x >>> 32 - k) >>> 0;
function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function makeRng(seedInt) {
  let z = seedInt >>> 0;
  const sm = () => {
    z = z + 2654435769 >>> 0;
    let t = z;
    t = Math.imul(t ^ t >>> 15, 2246822507) >>> 0;
    t = Math.imul(t ^ t >>> 13, 3266489909) >>> 0;
    return (t ^ t >>> 16) >>> 0;
  };
  let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
  const next = () => {
    const r = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = s1 << 9 >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return r;
  };
  const float = () => next() / 4294967296;
  return {
    next,
    float,
    range: (a, b) => a + float() * (b - a),
    int: (n) => next() % n,
    // Irwin-Hall normal: pure arithmetic, no transcendentals, fully deterministic.
    normal: () => {
      let s = 0;
      for (let i = 0; i < 12; i++) s += float();
      return s - 6;
    },
    gumbel: () => -detLog(-detLog(float() + 1e-12) + 1e-12),
    state: () => [s0, s1, s2, s3],
    setState: (st) => {
      s0 = st[0] >>> 0;
      s1 = st[1] >>> 0;
      s2 = st[2] >>> 0;
      s3 = st[3] >>> 0;
    }
  };
}
function deriveSeed(root, label) {
  return (seedFromString(label) ^ Math.imul(root >>> 0, 2654435769)) >>> 0;
}
var q6 = (x) => Math.round(x * 1e6) / 1e6;
var clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
var sigmoid = (z) => 1 / (1 + detExp(-z));
var PARAMS = {
  X_MAX: 3,
  // logit location of a maximal-implication event
  KAPPA: 0.63,
  // observation precision scale (calibrated)
  TAU_FLOOR: 0.35,
  TAU_CEIL: 5,
  Q_VOLATILITY: 0.022,
  // process noise per year
  CROWD_LOC: 0.5,
  KAPPA_CROWD: 0.3,
  D_SENS_NORM: 0.7
  // normative deniability discount
};
function updateBelief(belief, xEvent, tauObs) {
  const tau = belief.tau;
  const K2 = tauObs / (tau + tauObs);
  return {
    mu: clamp(belief.mu + K2 * (xEvent - belief.mu), -6, 6),
    tau: clamp(tau + tauObs, PARAMS.TAU_FLOOR, PARAMS.TAU_CEIL)
  };
}
function ageBelief(belief, years) {
  const inv = 1 / belief.tau + PARAMS.Q_VOLATILITY * years;
  const pull = Math.min(0.1, 0.012 * years);
  return { mu: belief.mu * (1 - pull), tau: clamp(1 / inv, PARAMS.TAU_FLOOR, PARAMS.TAU_CEIL) };
}
var FAMILIES = ["A", "B", "C", "D"];
var FAMILY_MIX = [["A", 0.35], ["B", 0.25], ["C", 0.22], ["D", 0.18]];
function drawFamily(u) {
  let acc = 0;
  for (const [f, p] of FAMILY_MIX) {
    acc += p;
    if (q6(u) < q6(acc)) return f;
  }
  return "D";
}
function makeElectorate(rng, n, blocOfPlayer, blocOfRival = "OPP", tilt = 0) {
  const agents = new Array(n);
  for (let i = 0; i < n; i++) {
    const lean = clamp(rng.normal() * 0.55, -1, 1);
    const interest = clamp(0.5 + rng.normal() * 0.22, 0.05, 1);
    const fam = drawFamily(rng.float());
    const biasDraw = () => clamp(Math.abs(rng.normal()) * 1.1 + 0.25 * interest, 0, 4);
    agents[i] = {
      id: i,
      lean,
      // −1 opposing bloc … +1 player's bloc
      side: lean > 0.15 ? blocOfPlayer : lean < -0.15 ? blocOfRival : "IND",
      ideology: clamp(rng.normal() * 0.5, -1, 1),
      interest,
      mediaTrust: clamp(0.55 + rng.normal() * 0.2, 0.05, 1),
      instTrust: clamp(0.55 + rng.normal() * 0.2, 0.05, 1),
      turnoutBase: clamp(0.45 + interest * 0.4 + rng.normal() * 0.12, 0.02, 0.98),
      crowdSens: clamp(0.4 + rng.normal() * 0.28, 0, 1),
      denialSens: clamp(0.6 + rng.normal() * 0.25, 0, 1),
      // What this voter is actually shopping for. Anti-correlated: nobody weights
      // everything equally, and the population's centre of gravity varies by world.
      wInt: clamp(1.5 - tilt + rng.normal() * 0.62, 0.15, 3),
      wComp: clamp(1.5 + tilt + rng.normal() * 0.62, 0.15, 3),
      family: fam,
      gateBias: fam === "B" ? biasDraw() : 0,
      motivBias: fam === "C" ? clamp(biasDraw() / 2.2, 0, 0.95) : 0,
      srcBias: fam === "D" ? clamp(biasDraw() / 2.2, 0, 0.95) : 0,
      // Who this voter is in policy terms: what they stand to gain or lose. Used only to
      // make the same decision land differently on different people. Never a targetable
      // segment, and never used to optimise persuasion.
      owner: rng.float() < 0.46,
      young: rng.float() < 0.34,
      publicSector: rng.float() < 0.22,
      business: rng.float() < 0.18,
      beliefs: {}
    };
  }
  return agents;
}
function seedBeliefs(agents, actorId, muBase, tauBase, rng) {
  for (const a of agents) {
    a.beliefs[actorId] = {
      integrity: { mu: muBase + rng.normal() * 0.4, tau: clamp(tauBase + rng.normal() * 0.15, 0.25, 5) },
      competence: { mu: muBase * 0.7 + rng.normal() * 0.4, tau: clamp(tauBase + rng.normal() * 0.15, 0.25, 5) }
    };
  }
}
function identityVars(agent, ev, playerBloc) {
  const targetSide = ev.targetSide;
  const agentWithPlayerBloc = agent.side === playerBloc;
  const incriminating = ev.implication < 0;
  let ownSideThreat = 0, outgroupTarget = 0;
  if (targetSide !== "NON_PARTISAN" && agent.side !== "IND") {
    const targetIsAgentsSide = targetSide === "PLAYER_SIDE" && agentWithPlayerBloc || targetSide === "OPPOSING_SIDE" && !agentWithPlayerBloc;
    if (incriminating) {
      if (targetIsAgentsSide) ownSideThreat = 1;
      else outgroupTarget = 1;
    }
  }
  const identityStakes = clamp(Math.abs(agent.lean) * 1.25, 0, 1);
  let sourceAlignment = 0.5;
  if (ev.sourceAlignment === "ALIGNED") sourceAlignment = agentWithPlayerBloc ? 0.85 : 0.15;
  else if (ev.sourceAlignment === "OPPOSED") sourceAlignment = agentWithPlayerBloc ? 0.15 : 0.85;
  return { ownSideThreat, outgroupTarget, identityStakes, sourceAlignment };
}
function blocsOf(a, playerBloc) {
  const out = [a.side === playerBloc ? "core" : a.side === "IND" ? "ind" : "opp"];
  if (a.owner) out.push("owner");
  if (a.young) out.push("young");
  if (a.publicSector) out.push("publicSector");
  if (a.business) out.push("business");
  return out;
}
var STAKE_GAIN = 1.9;
function stakeShift(a, ev, playerBloc) {
  const s = ev.stakes;
  if (!s) return 0;
  let v = 0;
  for (const k of ["owner", "young", "publicSector", "business"]) if (a[k] && s[k]) v += s[k];
  v += a.side === playerBloc ? s.core || 0 : a.side === "IND" ? s.ind || 0 : s.opp || 0;
  return v * STAKE_GAIN;
}
function applyEvent(agents, ev, rng, playerBloc, opts = {}) {
  const trait = ev.trait || "integrity";
  const before = meanBelief(agents, ev.actorId, trait);
  const byFamily = { A: 0, B: 0, C: 0, D: 0 };
  const byBloc = {};
  const blocN = {};
  const famN = { A: 0, B: 0, C: 0, D: 0 };
  const bySide = {};
  const sideN = {};
  let exposed = 0, admitted = 0;
  const baseImpl = ev.implication;
  const suppress = opts.suppress || {};
  for (const a of agents) {
    const b = a.beliefs[ev.actorId];
    if (!b) continue;
    const b0 = b[trait].mu;
    const iv = identityVars(a, ev, playerBloc);
    const pExp = clamp(a.interest * (ev.mediaReach ?? 0.8) * (1 + (ev.salience ?? 0)), 0, 1);
    if (q6(rng.float()) >= q6(pExp)) {
      accum(a, 0);
      continue;
    }
    exposed++;
    let rel = ev.reliability * (0.55 + 0.45 * a.mediaTrust);
    let diag = ev.diagnosticity;
    let admit = true;
    const gateDraw = rng.float();
    if (a.family === "B") {
      const z = -0.2 + 2.6 * ev.reliability + 1.4 * (1 - ev.deniability) + 0.9 * (iv.sourceAlignment - 0.5) - (suppress.gate ? 0 : a.gateBias * iv.ownSideThreat * iv.identityStakes) + (suppress.gate ? 0 : 0.5 * a.gateBias * iv.outgroupTarget * iv.identityStakes);
      admit = q6(gateDraw) < q6(sigmoid(z));
    }
    if (a.family === "C" && !suppress.motiv) {
      diag = clamp(diag * (1 - a.motivBias * iv.ownSideThreat * iv.identityStakes) * (1 + 0.5 * a.motivBias * iv.outgroupTarget * iv.identityStakes), 0, 1);
    }
    if (a.family === "D" && !suppress.source) {
      rel = clamp(rel * (1 - a.srcBias * iv.ownSideThreat * iv.identityStakes * (1 - iv.sourceAlignment)), 0, 1);
    }
    if (!admit) {
      accum(a, 0);
      continue;
    }
    admitted++;
    const dSens = suppress.deniability ? 0 : PARAMS.D_SENS_NORM * 0.5 + a.denialSens * 0.5;
    const relEff = rel * (1 - ev.deniability * dSens);
    const tauObs = PARAMS.KAPPA * ev.strength * relEff * diag;
    const implForAgent = clamp(baseImpl + stakeShift(a, ev, playerBloc), -1, 1);
    b[trait] = updateBelief(b[trait], PARAMS.X_MAX * implForAgent, tauObs);
    if (ev.crowd && !suppress.crowd) {
      const indep = ev.crowd.independence ?? 0.25;
      const tauCrowd = PARAMS.KAPPA_CROWD * ev.crowd.magnitude * a.crowdSens * indep;
      const xCrowd = PARAMS.X_MAX * ev.crowd.direction * ev.crowd.magnitude * PARAMS.CROWD_LOC;
      b[trait] = updateBelief(b[trait], xCrowd, tauCrowd);
    }
    accum(a, b[trait].mu - b0);
  }
  function accum(a, d) {
    for (const k of blocsOf(a, playerBloc)) {
      byBloc[k] = (byBloc[k] || 0) + d;
      blocN[k] = (blocN[k] || 0) + 1;
    }
    byFamily[a.family] += d;
    famN[a.family]++;
    bySide[a.side] = (bySide[a.side] || 0) + d;
    sideN[a.side] = (sideN[a.side] || 0) + 1;
  }
  const after = meanBelief(agents, ev.actorId, trait);
  const fam = {};
  for (const f of FAMILIES) fam[f] = famN[f] ? byFamily[f] / famN[f] : 0;
  const sides = {};
  for (const k of Object.keys(bySide)) sides[k] = bySide[k] / sideN[k];
  return {
    before,
    after,
    delta: after - before,
    exposedPct: exposed / agents.length,
    admittedPct: exposed ? admitted / exposed : 0,
    byFamily: fam,
    bySide: sides,
    byBloc: Object.fromEntries(Object.keys(byBloc).map((k) => [k, byBloc[k] / (blocN[k] || 1)])),
    blocN
  };
}
function actionSignals(features, ctx = {}) {
  const f = features || {};
  const scrutiny = ctx.scrutiny ?? 0.6;
  const salience = ctx.salience ?? 0;
  const integrity = clamp(
    0.55 * (f.transparency || 0) + 0.5 * (f.concession || 0) + 0.3 * (f.proceduralRestraint || 0) - 0.6 * (f.exploitation || 0) - 0.45 * (f.deflection || 0) - 0.45 * (f.selfProtection || 0) - 0.4 * (f.institutionalCost || 0),
    -1,
    1
  );
  const decisive = 0.7 * (f.exploitation || 0) + 0.5 * (f.electoralGain > 0 ? f.electoralGain : 0) + 0.35 * (f.concession || 0) + 0.25 * (f.transparency || 0);
  const hesitant = 0.65 * (f.deflection || 0) + 0.62 * (f.proceduralRestraint || 0) + 0.35 * (f.selfProtection || 0);
  const competence = clamp((decisive - hesitant) * (0.45 + 1.05 * salience) + 0.4 * (f.horizon > 0 ? f.horizon : 0) * (1 - salience), -1, 1);
  const reach = clamp(0.3 + scrutiny * 0.55 + salience * 0.2, 0.1, 1);
  const mk = (impl, trait, dg) => Math.abs(impl) < 0.05 ? null : {
    implication: impl,
    strength: 0.45 + 0.25 * Math.abs(impl),
    reliability: 0.95,
    diagnosticity: dg,
    deniability: 0,
    trait,
    targetSide: "PLAYER_SIDE",
    // Damaging coverage of you is carried by outlets hostile to you. That is the
    // whole substrate for "they've got an agenda" — with a neutral source it never bites.
    sourceAlignment: impl < 0 ? "OPPOSED" : "ALIGNED",
    crowd: null,
    mediaReach: reach
  };
  return [mk(integrity, "integrity", 0.55), mk(competence, "competence", 0.6)].filter(Boolean).map((o) => ctx.stakes ? { ...o, stakes: ctx.stakes } : o);
}
function choiceLiability(features) {
  const f = features || {};
  return Math.max(
    0,
    1 * (f.exploitation || 0) + 0.7 * (f.deflection || 0) + 0.6 * (f.selfProtection || 0) + 0.55 * (f.institutionalCost || 0) - 0.45 * (f.transparency || 0) - 0.35 * (f.proceduralRestraint || 0)
  );
}
function liabilityReckoning(total, thr = 1.8) {
  if (total < thr) return null;
  const over = Math.min(total - thr, 3.2);
  return {
    magnitude: over,
    signal: {
      implication: -clamp(0.18 + 0.2 * over, 0, 0.85),
      strength: 0.72,
      reliability: 0.9,
      diagnosticity: 0.8,
      deniability: 0.1,
      trait: "integrity",
      targetSide: "PLAYER_SIDE",
      sourceAlignment: "OPPOSED",
      crowd: { direction: -1, magnitude: clamp(0.25 + 0.18 * over, 0, 0.8), independence: 0.3 },
      mediaReach: clamp(0.55 + 0.12 * over, 0, 0.95)
    }
  };
}
function chainVerdict(outcome, credence, move) {
  const believed = credence === null || credence === void 0 ? 0.5 : [0.15, 0.4, 0.6, 0.85][credence];
  const procedural = move?.features?.proceduralRestraint ?? 0;
  const sanctioned = (move?.features?.exploitation ?? 0) + (move?.features?.concession ?? 0);
  const shielded = (move?.features?.selfProtection ?? 0) + (move?.features?.deflection ?? 0);
  let credibility = 0, calledIt = null;
  if (outcome === "CONFIRMED") {
    credibility = (believed - 0.5) * 1.4 - shielded * 0.55 + procedural * 0.25;
    calledIt = believed >= 0.45;
  } else if (outcome === "DISPROVEN") {
    credibility = (0.5 - believed) * 1.4 - sanctioned * 0.6 + procedural * 0.45;
    calledIt = believed <= 0.55;
  } else {
    credibility = procedural * 0.3 - Math.abs(believed - 0.5) * 0.35 - sanctioned * 0.2;
    calledIt = null;
  }
  credibility = clamp(credibility, -1, 1);
  const tone = outcome === "UNRESOLVED" ? "murky" : credibility > 0.06 ? "right" : credibility < -0.06 ? "wrong" : "mixed";
  return {
    outcome,
    tone,
    beliefTone: tone,
    calledIt,
    credibility,
    believed,
    procedural,
    signal: Math.abs(credibility) < 0.06 ? null : {
      implication: credibility,
      strength: 0.7,
      reliability: 0.95,
      diagnosticity: 0.65,
      deniability: 0,
      trait: "competence",
      targetSide: "PLAYER_SIDE",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.75
    }
  };
}
function meanBelief(agents, actorId, trait = "integrity") {
  let s = 0, n = 0;
  for (const a of agents) {
    const b = a.beliefs[actorId];
    if (b) {
      s += sigmoid(b[trait].mu);
      n++;
    }
  }
  return n ? s / n : 0.5;
}
function meanPrecision(agents, actorId, trait = "integrity") {
  let s = 0, n = 0;
  for (const a of agents) {
    const b = a.beliefs[actorId];
    if (b) {
      s += b[trait].tau;
      n++;
    }
  }
  return n ? s / n : 1;
}
function approvalOf(agents, actorId) {
  let s = 0;
  for (const a of agents) {
    const b = a.beliefs[actorId];
    if (!b) continue;
    const wi = a.wInt ?? 1.5, wc = a.wComp ?? 1.5;
    s += (wi * sigmoid(b.integrity.mu) + wc * sigmoid(b.competence.mu)) / (wi + wc);
  }
  return s / agents.length;
}
function ageElectorate(agents, years) {
  for (const a of agents) {
    for (const k of Object.keys(a.beliefs)) {
      a.beliefs[k].integrity = ageBelief(a.beliefs[k].integrity, years);
      a.beliefs[k].competence = ageBelief(a.beliefs[k].competence, years);
    }
  }
}
var W = { party: 1.4, ideology: 0.7, retro: 1.75, noise: 0.6 };
function runElection(agents, candidates, rng, ctx = {}) {
  const tally = {};
  const util = {};
  for (const c of candidates) {
    tally[c.id] = 0;
    util[c.id] = 0;
  }
  let turnedOut = 0;
  for (const a of agents) {
    const us = candidates.map((c) => {
      const b = a.beliefs[c.id];
      const partyMatch = c.bloc === "IND" ? 0 : a.side === c.bloc ? 1 : a.side === "IND" ? 0.15 : -1;
      let u = W.party * partyMatch * Math.abs(a.lean) - W.ideology * Math.abs(a.ideology - (c.ideology ?? 0)) + W.retro * (c.retro ?? 0) * (0.4 + 0.6 * a.instTrust) + W.noise * rng.gumbel();
      if (b) u += (a.wInt ?? 1.5) * (sigmoid(b.integrity.mu) - 0.5) + (a.wComp ?? 1.5) * (sigmoid(b.competence.mu) - 0.5);
      else u -= 0.6;
      u += (c.homeAdvantage ?? 0) * (a.side === c.bloc ? 1 : 0.3);
      u += 0.85 * ((c.recognition ?? 0.5) - 0.5) * (0.5 + 0.5 * a.interest);
      return { id: c.id, u };
    });
    us.sort((x, y) => q6(y.u) - q6(x.u));
    for (const c of us) util[c.id] += c.u;
    const margin = q6(us[0].u - (us[1] ? us[1].u : us[0].u - 1));
    const mobilise = ctx.mobilisation?.[us[0].id] ?? 0;
    const pVote = clamp(a.turnoutBase + 0.1 * clamp(margin, 0, 2) + mobilise - 0.12 * (1 - a.interest), 0.01, 0.99);
    if (q6(rng.float()) < q6(pVote)) {
      turnedOut++;
      tally[us[0].id]++;
    }
  }
  const total = Object.values(tally).reduce((x, y) => x + y, 0) || 1;
  const shares = {};
  for (const c of candidates) shares[c.id] = tally[c.id] / total;
  const winner = candidates.reduce((best, c) => tally[c.id] > tally[best.id] ? c : best, candidates[0]);
  return { tally, shares, winner: winner.id, turnout: turnedOut / agents.length };
}
var CRED = [0.15, 0.4, 0.6, 0.85];
var SAID = [
  "said there was nothing there",
  "called it probably overblown",
  "thought it was probably real",
  "treated it as established"
];
function linSlope(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += detSquare(xs[i] - mx);
    sy += detSquare(ys[i] - my);
  }
  if (den < 1e-9) return null;
  const slope = num / den;
  const r2 = sy < 1e-9 ? 0 : num * num / (den * sy);
  return { slope, r2, n };
}
function confFromPairs(diffs) {
  if (diffs.length === 0) return 0;
  if (diffs.length === 1) return 0.38;
  const mean2 = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + detSquare(b - mean2), 0) / diffs.length);
  const agreement = diffs.every((d) => Math.sign(d) === Math.sign(mean2)) ? 1 : 0.45;
  const base = clamp(0.3 + 0.16 * diffs.length, 0, 0.86);
  return clamp(base * agreement * (1 - clamp(sd / 0.5, 0, 0.5)), 0, 0.92);
}
function analysePlayer(log) {
  const reads = log.filter((e) => e.kind === "read");
  const moves = log.filter((e) => e.kind === "move");
  const dims = {};
  const xs = reads.map((r) => r.strength * r.reliability);
  const ys = reads.map((r) => CRED[r.credence]);
  const fit = linSlope(xs, ys);
  const sorted = [...reads].sort((a, b) => b.strength * b.reliability - a.strength * a.reliability);
  const evCases = reads.length >= 2 ? [{
    hi: { title: sorted[0].title, said: SAID[sorted[0].credence], q: sorted[0].strength * sorted[0].reliability },
    lo: {
      title: sorted[sorted.length - 1].title,
      said: SAID[sorted[sorted.length - 1].credence],
      q: sorted[sorted.length - 1].strength * sorted[sorted.length - 1].reliability
    },
    diff: CRED[sorted[0].credence] - CRED[sorted[sorted.length - 1].credence]
  }] : [];
  dims.evidenceSensitivity = {
    cases: evCases,
    label: "Evidence Sensitivity",
    n: reads.length,
    value: fit ? clamp(fit.slope, -1.2, 1.6) : null,
    conf: fit ? clamp(0.22 + 0.05 * fit.n + 0.3 * fit.r2, 0, 0.9) : 0,
    detail: fit ? `slope ${fit.slope.toFixed(2)} across ${fit.n} judgments` : "not enough judgments"
  };
  const pairDim = (factor, key, label, hi) => {
    const groups = {};
    for (const r of reads) {
      if (!r.pairId || r.factor !== factor) continue;
      (groups[r.pairId] ||= []).push(r);
    }
    const diffs = [];
    const cases = [];
    for (const pid of Object.keys(groups)) {
      const g = groups[pid];
      if (g.length !== 2) continue;
      const a = g.find((x) => x.level === hi), b = g.find((x) => x.level !== hi);
      if (!a || !b) continue;
      diffs.push(CRED[a.credence] - CRED[b.credence]);
      cases.push({
        diff: CRED[a.credence] - CRED[b.credence],
        hi: { title: a.title, said: SAID[a.credence], q: a.strength * a.reliability },
        lo: { title: b.title, said: SAID[b.credence], q: b.strength * b.reliability }
      });
    }
    const mean2 = diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : null;
    dims[key] = { label, n: diffs.length, value: mean2, conf: confFromPairs(diffs), cases };
  };
  pairDim("PARTISAN", "partisanSymmetry", "Partisan Symmetry", "OPPOSING_SIDE");
  pairDim("CROWD", "crowdSusceptibility", "Crowd Susceptibility", "CROWD_HIGH");
  pairDim("DENIABILITY", "deniabilitySusceptibility", "Deniability Susceptibility", "DEN_HIGH");
  const feat = (name, filter = () => true) => {
    const v = moves.filter(filter).map((m) => m.features[name] ?? 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const respMoves = moves.filter((m) => m.responsibility);
  const pol = {};
  pol.accountability = {
    label: "Accountability",
    n: respMoves.length,
    value: respMoves.length ? feat("concession", (m) => m.responsibility) - feat("deflection", (m) => m.responsibility) : null
  };
  pol.institutionalRestraint = {
    label: "Institutional Restraint",
    n: moves.filter((m) => m.institutional).length,
    value: moves.some((m) => m.institutional) ? feat("proceduralRestraint", (m) => m.institutional) - feat("institutionalCost", (m) => m.institutional) : null
  };
  pol.powerOrientation = {
    label: "Power / Survival Orientation",
    n: moves.length,
    value: moves.length ? feat("electoralGain") - feat("horizon") : null
  };
  const cite = (filter, feat2) => moves.filter(filter).sort((a, b) => (b.features[feat2] ?? 0) - (a.features[feat2] ?? 0)).slice(0, 2).map((m) => ({ title: m.title, label: m.label }));
  pol.accountability.cases = cite((m) => m.responsibility, "concession");
  pol.institutionalRestraint.cases = cite((m) => m.institutional, "proceduralRestraint");
  pol.powerOrientation.cases = cite(() => true, "electoralGain");
  for (const k of Object.keys(pol)) pol[k].conf = clamp(0.18 + 0.11 * pol[k].n, 0, 0.85);
  return { voter: dims, political: pol, nReads: reads.length, nMoves: moves.length };
}
function mirrorResolution(analysis, log) {
  const reads = log.filter((e) => e.kind === "read");
  const volume = clamp(reads.length / 14, 0, 1);
  const cats = /* @__PURE__ */ new Set();
  for (const r of reads) {
    if (r.strength * r.reliability > 0.5) cats.add("strongEvidence");
    else cats.add("weakEvidence");
    if (r.targetSide === "OPPOSING_SIDE") cats.add("opposing");
    if (r.targetSide === "PLAYER_SIDE") cats.add("aligned");
    if (r.factor === "CROWD" && r.level === "CROWD_HIGH") cats.add("crowd");
    if (r.factor === "DENIABILITY" && r.level === "DEN_HIGH") cats.add("deniable");
  }
  for (const m of log.filter((e) => e.kind === "move")) {
    if (m.institutional) cats.add("institutional");
    if (m.temptation) cats.add("temptation");
    if (m.responsibility) cats.add("personalExposure");
  }
  const COVER = ["strongEvidence", "weakEvidence", "opposing", "aligned", "crowd", "deniable", "institutional", "temptation", "personalExposure"];
  const coverage = COVER.filter((c) => cats.has(c)).length / COVER.length;
  const dimsWithPairs = ["partisanSymmetry", "crowdSusceptibility", "deniabilitySusceptibility"];
  const replication = dimsWithPairs.reduce((acc, k) => acc + clamp((analysis.voter[k]?.n ?? 0) / 2, 0, 1), 0) / dimsWithPairs.length;
  const confs = [...Object.values(analysis.voter), ...Object.values(analysis.political)].map((d) => d.conf ?? 0);
  const consistency = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const res = 0.3 * volume + 0.3 * coverage + 0.2 * replication + 0.2 * consistency;
  return {
    resolution: clamp(res, 0, 0.98),
    components: { volume, coverage, replication, consistency },
    missing: COVER.filter((c) => !cats.has(c))
  };
}
function crossMirror(analysis, log) {
  const out = [];
  const ps = analysis.voter.partisanSymmetry;
  const moves = log.filter((e) => e.kind === "move");
  const ownExposure = moves.filter((m) => m.responsibility);
  const proceduralWhenExposed = ownExposure.length ? ownExposure.reduce((a, m) => a + (m.features.proceduralRestraint ?? 0), 0) / ownExposure.length : null;
  if (ps && ps.n > 0 && proceduralWhenExposed !== null) {
    const asked = ps.value;
    if (proceduralWhenExposed >= 0.25 && asked > 0.08) {
      out.push({
        title: "You valued due process most when you needed it yourself.",
        politician: `When you were the one exposed, you chose the procedural option ${(proceduralWhenExposed * 100).toFixed(0)}% of the way.`,
        voter: `In matched controversies with the same evidence, you were ${(asked * 100).toFixed(0)} points readier to believe the charge when the target was on the other side.`,
        options: ["I trusted the process more when I could see it up close", "I judged the other side more harshly", "The two situations were not really the same"]
      });
    }
  }
  const crowd = analysis.voter.crowdSusceptibility;
  const usedOutrage = moves.length ? moves.reduce((a, m) => a + (m.features.exploitation ?? 0), 0) / moves.length : 0;
  if (crowd && crowd.n > 0 && crowd.value !== null && crowd.value > 0.08 && usedOutrage < 0.5) {
    out.push({
      title: "You resisted using outrage \u2014 but you were not immune to it.",
      politician: `You rarely reached for the outrage play (${(usedOutrage * 100).toFixed(0)}% across your responses).`,
      voter: `With the same underlying evidence, visible public anger moved your judgment by ${(crowd.value * 100).toFixed(0)} points.`,
      options: ["Public anger is information", "I was influenced more than I thought", "One comparison is not enough to say"]
    });
  }
  if (ps && ps.n > 0 && ps.value !== null && ps.value > 0.25 && (proceduralWhenExposed === null || proceduralWhenExposed < 0.25)) {
    const sanction = moves.filter((m) => !m.responsibility).reduce((a, m) => a + (m.features.exploitation ?? 0), 0) / Math.max(1, moves.filter((m) => !m.responsibility).length);
    out.push({
      title: "Your evidence bar moved with the target.",
      politician: `When the story was about someone else you reached for the hard option ${(sanction * 100).toFixed(0)}% of the way.`,
      voter: `Privately, with identical evidence in both cases, you were ${(ps.value * 100).toFixed(0)} points readier to believe it when the person was on the other side.`,
      options: ["I had reasons to trust my own side", "I applied a lower bar to opponents", "The cases were not really identical"]
    });
  }
  const ev = analysis.voter.evidenceSensitivity;
  const exploited = moves.length ? moves.reduce((a, m) => a + (m.features.exploitation ?? 0), 0) / moves.length : 0;
  if (ev && ev.n >= 4 && ev.value !== null && ev.value > 0.35 && exploited > 0.4) {
    out.push({
      title: "You wanted evidence. You did not always wait for it.",
      politician: `Across your public responses you reached for the aggressive option ${(exploited * 100).toFixed(0)}% of the way.`,
      voter: `Yet your private judgments tracked evidence quality closely \u2014 you moved ${ev.value.toFixed(2)} points of credence per unit of evidence.`,
      options: ["Knowing better and acting anyway is just politics", "I was harsher in public than in private", "Winning required it"]
    });
  }
  return out;
}
function checklist(analysis) {
  const out = [];
  const v = analysis.voter;
  if (v.crowdSusceptibility?.n > 0 && (v.crowdSusceptibility.value ?? 0) > 0.1)
    out.push("When a controversy goes viral, read the underlying evidence before you read the comments or the reaction counts.");
  if (v.partisanSymmetry?.n > 0 && Math.abs(v.partisanSymmetry.value ?? 0) > 0.12)
    out.push("Ask what evidence you would need if the politician belonged to the other side.");
  if (v.deniabilitySusceptibility?.n > 0 && (v.deniabilitySusceptibility.value ?? 0) < -0.1)
    out.push('"AI-generated" is itself a claim, and it needs evidence of its own.');
  if (v.evidenceSensitivity?.value !== null && (v.evidenceSensitivity?.value ?? 0) < 0.25)
    out.push("Your judgments moved little between weak and strong evidence. Try naming, out loud, what would change your mind.");
  if (out.length === 0) out.push("Nothing in this run cleared the evidence bar for personalized advice. That is a real result, not a placeholder.");
  return out;
}
function makeTape() {
  return { entries: [] };
}
function tapeEvent(tape, ev) {
  tape.entries.push({ t: "event", ev });
}
function tapeElection(tape, spec) {
  tape.entries.push({ t: "election", spec });
}
function tapeAge(tape, age, years, label = "extra time", mode = "extra") {
  tape.entries.push({ t: "age", age, years, label, mode });
}
function buildInitialWorld(world) {
  const wr = makeRng(world.worldSeed);
  const tilt = wr.range(-0.85, 0.85);
  const agents = makeElectorate(wr, world.n, world.playerBloc, world.rivalBloc, tilt);
  seedBeliefs(agents, "PLAYER", world.startMu, world.startTau, wr);
  const rq = wr.range(-0.25, 0.75);
  seedBeliefs(agents, "RIVAL1", 0.35 + rq * 0.7, 1.25, wr);
  seedBeliefs(agents, "RIVAL2", rq * 0.3, 0.45, wr);
  return { agents, wr, tilt, rq };
}
function choiceAvailability(choice, st) {
  const cost = choice.cost;
  if (!cost) return { ok: true };
  for (const [k, v] of Object.entries(cost)) {
    if ((st[k] ?? 0) < v) {
      return {
        ok: false,
        reason: choice.lockNote || "You do not have the resources for this.",
        need: { key: k, have: st[k] ?? 0, want: v }
      };
    }
  }
  return { ok: true };
}
function payCost(choice, st) {
  for (const [k, v] of Object.entries(choice.cost || {})) st[k] = Math.max(0, (st[k] ?? 0) - v);
}

// src/abilities.mjs
var ABILITY_MIN = 20;
var ABILITY_MAX = 80;
var ABILITIES = [
  {
    id: "COMM",
    name: "Public Communication",
    short: "Communication",
    does: "Speeches, debates, press conferences, live town halls. How well a public statement lands, and how fast people come to know who you are."
  },
  {
    id: "POLICY",
    name: "Policy & Governance",
    short: "Policy",
    does: "Drafting, delivery and administration. Whether what you promised actually works, and whether technical options are open to you at all."
  },
  {
    id: "ORG",
    name: "Organization",
    short: "Organization",
    does: "Field operation, volunteers, canvassing, turnout. Converts money and party standing into people who actually vote."
  },
  {
    id: "NEG",
    name: "Negotiation",
    short: "Negotiation",
    does: "Party bargaining, coalitions, legislative deals. What it costs you to get other people to move."
  },
  {
    id: "STRAT",
    name: "Political Strategy",
    short: "Strategy",
    does: "Reading the position. Better internal information, sharper forecasts, steadier judgment when everything is on fire."
  }
];
var ABILITY_IDS = ABILITIES.map((a) => a.id);
var abClamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
var BACKGROUND_ABILITIES = {
  STAFF: {
    label: "Legislative staffer",
    base: { COMM: 36, POLICY: 52, ORG: 40, NEG: 54, STRAT: 50 },
    talent: { COMM: 0.6, POLICY: 1.3, ORG: 0.7, NEG: 1.5, STRAT: 1.4 },
    note: "You know how a bill actually moves and who has to be asked. You have never had to hold a room."
  },
  CIVIC: {
    label: "Community organiser",
    base: { COMM: 53, POLICY: 36, ORG: 56, NEG: 42, STRAT: 43 },
    talent: { COMM: 1.5, POLICY: 0.6, ORG: 1.6, NEG: 0.8, STRAT: 0.9 },
    note: "You can fill a hall and knock a ward. Nobody in the building owes you a favour and you have never drafted anything."
  },
  PROF: {
    label: "Municipal auditor",
    base: { COMM: 38, POLICY: 57, ORG: 39, NEG: 45, STRAT: 51 },
    talent: { COMM: 0.6, POLICY: 1.6, ORG: 0.6, NEG: 0.9, STRAT: 1.3 },
    note: "You can read a procurement file faster than anyone in the chamber. You are not who they send to the doorstep."
  }
};
var APTITUDE_BANDS = [
  { key: "signature", lo: 70, hi: 80 },
  { key: "strong", lo: 58, hi: 68 },
  { key: "ordinary", lo: 48, hi: 60 },
  { key: "ordinary2", lo: 48, hi: 60 },
  { key: "narrow", lo: 38, hi: 50 }
];
function weightedOrder(rng, weights) {
  const pool = ABILITY_IDS.map((id) => ({ id, w: Math.max(0.05, weights[id] ?? 1) }));
  const out = [];
  while (pool.length) {
    let total = 0;
    for (const p of pool) total += p.w;
    let r = rng.float() * total, i = 0;
    while (i < pool.length - 1 && r > pool[i].w) {
      r -= pool[i].w;
      i++;
    }
    out.push(pool[i].id);
    pool.splice(i, 1);
  }
  return out;
}
function rollAptitude(rng, backgroundId) {
  const bg = BACKGROUND_ABILITIES[backgroundId] || BACKGROUND_ABILITIES.STAFF;
  const order = weightedOrder(rng, bg.talent);
  const tail = order.slice(2);
  const narrowId = tail.reduce((lo, id) => bg.base[id] < bg.base[lo] ? id : lo, tail[0]);
  const rest = order.filter((id) => id !== narrowId);
  const apt = {};
  const bands = {};
  rest.forEach((id, i) => {
    const b = APTITUDE_BANDS[i];
    apt[id] = Math.round(b.lo + rng.float() * (b.hi - b.lo));
    bands[id] = b.key;
  });
  const lb = APTITUDE_BANDS[APTITUDE_BANDS.length - 1];
  apt[narrowId] = Math.round(lb.lo + rng.float() * (lb.hi - lb.lo));
  bands[narrowId] = lb.key;
  for (const id of ABILITY_IDS) apt[id] = abClamp(apt[id], bg.base[id] + 2, ABILITY_MAX);
  return { aptitude: apt, bands };
}
function makeAbilities(rng, backgroundId) {
  const bg = BACKGROUND_ABILITIES[backgroundId] || BACKGROUND_ABILITIES.STAFF;
  const { aptitude, bands } = rollAptitude(rng, backgroundId);
  const value = {};
  const xp = {};
  for (const id of ABILITY_IDS) {
    value[id] = abClamp(bg.base[id] + Math.round(rng.range(-3, 3)), ABILITY_MIN, ABILITY_MAX);
    xp[id] = 0;
  }
  return { value, aptitude, bands, xp, dp: 0, history: {}, spent: 0 };
}
function costToRaise(ab, id) {
  const v = ab.value[id];
  if (v >= ABILITY_MAX) return null;
  let c = v < 50 ? 1 : v < 60 ? 2 : v < 70 ? 3 : 4;
  if (v >= ab.aptitude[id]) c *= 2;
  if (hasMomentum(ab, id)) c = Math.max(1, c - 1);
  return c;
}
var MOMENTUM_THRESHOLD = 3;
function hasMomentum(ab, id) {
  return (ab.xp[id] || 0) >= MOMENTUM_THRESHOLD;
}
function raise(ab, id, times = 1) {
  for (let i = 0; i < times; i++) {
    const c = costToRaise(ab, id);
    if (c === null || ab.dp < c) return false;
    ab.dp -= c;
    ab.spent += c;
    ab.value[id] = abClamp(ab.value[id] + 1, ABILITY_MIN, ABILITY_MAX);
    if (hasMomentum(ab, id)) ab.xp[id] = Math.max(0, ab.xp[id] - MOMENTUM_THRESHOLD);
  }
  return true;
}
function addExperience(ab, tags, label) {
  for (const id of tags) {
    if (!ABILITY_IDS.includes(id)) continue;
    ab.xp[id] = (ab.xp[id] || 0) + 1;
    (ab.history[id] ||= []).push(label);
    if (ab.history[id].length > 6) ab.history[id].shift();
  }
  return ab;
}
function grantPoints(ab, n, reason) {
  ab.dp += n;
  (ab.history._grants ||= []).push({ n, reason });
  return ab;
}
function check2(ab, id, dc, rng, opts = {}) {
  const pressure = opts.pressure || 0;
  const relief = Math.round((ab.value.STRAT - 50) / 10 * 2);
  const effDc = dc + pressure - Math.max(0, relief) * (pressure > 0 ? 1 : 0);
  const margin = ab.value[id] - effDc + Math.round(rng.range(-16, 16));
  const grade = margin >= 10 ? "excellent" : margin >= 0 ? "solid" : margin >= -12 ? "poor" : "botched";
  const scale = { excellent: 1.35, solid: 1.05, poor: 0.65, botched: 0.35 }[grade];
  return { grade, margin, scale, effDc, ok: margin >= 0 };
}
function mobilisationMultiplier(ab) {
  return abClamp(0.45 + (ab.value.ORG - 40) * 0.03, 0.45, 1.85);
}
function recognitionGain(ab, base) {
  return base * abClamp(0.5 + (ab.value.COMM - 40) * 0.02, 0.5, 1.6);
}
function meets(ab, req) {
  if (!req) return true;
  for (const [id, v] of Object.entries(req)) if ((ab.value[id] ?? 0) < v) return false;
  return true;
}
function unmetReason(ab, req) {
  for (const [id, v] of Object.entries(req || {})) {
    if ((ab.value[id] ?? 0) < v) {
      const a = ABILITIES.find((x) => x.id === id);
      return `${a ? a.name : id} ${ab.value[id]} \u2014 this needs about ${v}.`;
    }
  }
  return null;
}
function splitBudget(total) {
  const primary = Math.max(1, Math.ceil(total * 0.65));
  return { primary, secondary: Math.max(0, total - primary) };
}
function spendUpTo(ab, id, budget) {
  const from = ab.value[id];
  let left = budget, guard = 0;
  while (left > 0 && guard++ < 40) {
    const c = costToRaise(ab, id);
    if (c === null || c > left) break;
    const before = ab.value[id];
    ab.dp += c;
    raise(ab, id);
    if (ab.value[id] === before) {
      ab.dp -= c;
      break;
    }
    left -= c;
  }
  return { from, to: ab.value[id], gained: ab.value[id] - from, spent: budget - left };
}
function applyFocus(ab, primaryId, secondaryId, total) {
  const { primary, secondary } = splitBudget(total);
  const byId = (fid, list) => list.find((f) => f.id === fid);
  const out = { primary: null, secondary: null };
  const carry = ab.dp;
  ab.dp = 0;
  if (primaryId) out.primary = { focus: primaryId, ...spendUpTo(ab, primaryId, primary) };
  if (secondaryId && secondary > 0) out.secondary = { focus: secondaryId, ...spendUpTo(ab, secondaryId, secondary) };
  ab.dp = carry;
  return out;
}

// src/election.mjs
var cl = (x, a, b) => Math.max(a, Math.min(b, x));
var ELECTION_CONFIG = {
  id: "pm-election-config",
  version: "0.37.1",
  // opponent
  rivalOffset: 0.3,
  // how strong the field is in general
  rivalArcJitter: 0.22,
  rivalPushMin: 0,
  rivalPushMax: 0.12,
  // the player's local advantage — earned, not granted
  homeBase: 0.03,
  homeStandingWeight: 0.03,
  homeFundsWeight: 0.012,
  homeTookSeatBonus: 0.06,
  homeTier1Cap: 0.3,
  homeTier2StandingWeight: 0.024,
  homeTier2Cap: 0.2,
  // the opponent's local advantage
  rivalHomeTier1: 0.1,
  rivalHomeTier2: 0.2,
  // the field operation: money and party standing, multiplied by Organization
  fundsWeight: 0.014,
  standingWeight: 0.02,
  mobilisationCapTier1: 0.32,
  // a ward race is a turnout game
  mobilisationCapTier2: 0.26,
  // retrospective record
  retroCapitalScale: 9,
  retroCapitalWeight: 0.28,
  retroCulvertFunded: 0.2,
  retroCulvertPartial: 0.05,
  retroCulvertFailed: -0.14,
  retroChoseSurvival: 0.18,
  retroChoseNeed: -0.16,
  retroTipBackfired: -0.16,
  retroComebackLocal: 0.2,
  retroComebackOther: 0.13,
  baseRecognition: 0.5,
  rivalRecognition: 0.5,
  rivalBaseRetro: 0.05,
  playerIdeology: 0.05,
  rivalIdeology: -0.1
};
var RIVAL_PROFILES = [
  { id: "CLEAN", integrity: 0.62, competence: -0.22 },
  { id: "EFFECTIVE", integrity: -0.32, competence: 0.66 },
  { id: "STRONG", integrity: 0.34, competence: 0.38 },
  { id: "WEAK", integrity: -0.06, competence: -0.1 }
];
function rollRival(wr, cfg = ELECTION_CONFIG) {
  const push = wr.range(cfg.rivalPushMin, cfg.rivalPushMax);
  const profile = RIVAL_PROFILES[wr.int(RIVAL_PROFILES.length)];
  const arc = [];
  for (const age of [28, 30, 32, 34, 36, 38, 39]) {
    for (const trait of ["integrity", "competence"]) {
      const target = profile[trait] + cfg.rivalOffset + wr.range(-cfg.rivalArcJitter, cfg.rivalArcJitter);
      arc.push({ age, trait, implication: Math.max(-1, Math.min(1, target)) });
    }
  }
  return { profile, profileId: profile.id, arc, push };
}
function retrospective(st, cfg = ELECTION_CONFIG) {
  const f = st.flags || {};
  const comebackRoute = st.out?.route || st.lastOutRoute;
  const wildCredit = f.CAME_BACK ? comebackRoute === "LOCAL" ? cfg.retroComebackLocal : cfg.retroComebackOther : 0;
  return cfg.retroCapitalWeight * detTanh((st.capital || 0) / cfg.retroCapitalScale) + wildCredit + (f.CULVERT_FUNDED ? cfg.retroCulvertFunded : f.CULVERT_PARTIAL ? cfg.retroCulvertPartial : cfg.retroCulvertFailed) + (f.CHOSE_SURVIVAL ? cfg.retroChoseSurvival : f.CHOSE_NEED ? cfg.retroChoseNeed : 0) + (f.TIP_BACKFIRED ? cfg.retroTipBackfired : 0);
}
function homeAdvantage(st, tier, cfg = ELECTION_CONFIG) {
  if (tier === 1) {
    return cl(cfg.homeBase + cfg.homeStandingWeight * (st.standing || 0) + cfg.homeFundsWeight * (st.funds || 0) + (st.flags?.TOOK_SEAT ? cfg.homeTookSeatBonus : 0), 0, cfg.homeTier1Cap);
  }
  return cl(cfg.homeTier2StandingWeight * (st.standing || 0), 0, cfg.homeTier2Cap);
}
function mobilisation(st, tier, cfg = ELECTION_CONFIG) {
  const mult = st.abilities ? mobilisationMultiplier(st.abilities) : 1;
  const cap = tier === 1 ? cfg.mobilisationCapTier1 : cfg.mobilisationCapTier2;
  return cl(mult * (cfg.fundsWeight * (st.funds || 0) + cfg.standingWeight * (st.standing || 0)), 0, cap);
}
function buildElectionSpec(st, beat, world, cfg = ELECTION_CONFIG) {
  const tier = beat.tier;
  const rivalId = tier === 1 ? "RIVAL1" : "RIVAL2";
  const spec = {
    electionId: beat.id,
    age: beat.age,
    office: beat.office,
    officeTier: tier,
    seed: world.seedFor("election-" + beat.id),
    configVersion: cfg.version,
    rivalProfileId: world.rivalProfileId,
    rivalPush: world.rivalPush,
    playerBloc: world.playerBloc,
    opponentBloc: world.rivalBloc,
    candidates: [
      {
        id: "PLAYER",
        bloc: world.playerBloc,
        ideology: cfg.playerIdeology,
        retro: retrospective(st, cfg),
        homeAdvantage: homeAdvantage(st, tier, cfg),
        recognition: Number.isFinite(st.recognition) ? st.recognition : cfg.baseRecognition
      },
      {
        id: rivalId,
        bloc: world.rivalBloc,
        ideology: cfg.rivalIdeology,
        retro: cfg.rivalBaseRetro + (tier === 2 ? world.rivalPush : 0),
        homeAdvantage: tier === 1 ? cfg.rivalHomeTier1 : cfg.rivalHomeTier2,
        recognition: cfg.rivalRecognition
      }
    ],
    ctx: { mobilisation: { PLAYER: mobilisation(st, tier, cfg) } }
  };
  validateElectionSpec(spec);
  return spec;
}
var NUMERIC_SPEC_FIELDS = ["age", "officeTier", "seed", "rivalPush"];
var NUMERIC_CANDIDATE_FIELDS = ["ideology", "retro", "homeAdvantage", "recognition"];
function validateElectionSpec(spec) {
  const where = (field) => `election "${spec.electionId}" (age ${spec.age}, tier ${spec.officeTier}, seed ${spec.seed}): ${field} is not a finite number`;
  for (const f of NUMERIC_SPEC_FIELDS)
    if (!Number.isFinite(spec[f])) throw new Error(where(f) + ` \u2014 got ${spec[f]}`);
  if (!spec.playerBloc || !spec.opponentBloc)
    throw new Error(`election "${spec.electionId}": missing bloc identity`);
  if (!Array.isArray(spec.candidates) || spec.candidates.length !== 2)
    throw new Error(`election "${spec.electionId}": needs exactly two candidates`);
  for (const c of spec.candidates) {
    for (const f of NUMERIC_CANDIDATE_FIELDS)
      if (!Number.isFinite(c[f])) throw new Error(where(`${c.id}.${f}`) + ` \u2014 got ${c[f]}`);
    if (!c.bloc) throw new Error(`election "${spec.electionId}": ${c.id} has no bloc`);
  }
  const m = spec.ctx?.mobilisation?.PLAYER;
  if (!Number.isFinite(m)) throw new Error(where("ctx.mobilisation.PLAYER") + ` \u2014 got ${m}`);
  return spec;
}
function validateElectionResult(res, spec) {
  const where = (field, v) => `election "${spec.electionId}" (age ${spec.age}, tier ${spec.officeTier}, seed ${spec.seed}): ${field} is invalid \u2014 got ${v}`;
  if (!Number.isFinite(res.turnout)) throw new Error(where("turnout", res.turnout));
  for (const c of spec.candidates) {
    const s = res.shares[c.id];
    if (!Number.isFinite(s)) throw new Error(where(`shares.${c.id}`, s));
  }
  if (res.turnout === 0) throw new Error(where("turnout", "0 \u2014 nobody voted, which means a NaN reached the utility function"));
  if (!res.winner) throw new Error(where("winner", res.winner));
  return res;
}
function holdElection(agents, st, beat, world, rng, cfg = ELECTION_CONFIG) {
  const spec = buildElectionSpec(st, beat, world, cfg);
  const res = runElection(agents, spec.candidates, rng(spec.seed), spec.ctx);
  validateElectionResult(res, spec);
  return { spec, res, won: res.winner === "PLAYER" };
}

// src/content.mjs
var BLOCS = {
  CIV: { id: "CIV", name: "Civic Alliance", axis: "Decisions belong close to the people affected by them.", color: "ochre" },
  REN: { id: "REN", name: "Renewal Front", axis: "A capable centre can move faster than a hundred committees.", color: "indigo" }
};
var OPP = (b) => b === "CIV" ? "REN" : "CIV";
var ROUTES = [
  {
    id: "STAFF",
    name: "Legislative staffer",
    blurb: "Six years drafting other people's bills. You know where the bodies are filed.",
    start: { capital: 3, funds: 4, standing: 5, mu: 0.15, tau: 0.55 }
  },
  {
    id: "CIVIC",
    name: "Community organiser",
    blurb: "You ran a tenants' union that beat the city twice. Nobody in the party owes you anything.",
    start: { capital: 4, funds: 1, standing: 1, mu: 0.45, tau: 0.4 }
  },
  {
    id: "PROF",
    name: "Municipal auditor",
    blurb: "You spent your twenties finding money that had gone missing. Some of it belonged to your future colleagues.",
    start: { capital: 2, funds: 3, standing: 2, mu: 0.55, tau: 0.7 }
  }
];
var LADDER = [
  [
    "There's nothing here. Someone is fishing.",
    "Probably overblown, but I want to know more.",
    "I think it's real. I'd want it confirmed.",
    "It happened. We should assume it happened."
  ],
  ["Weak lead", "Plausible", "Likely true", "Near certain"]
];
var F = (o) => ({
  selfProtection: 0,
  proceduralRestraint: 0,
  concession: 0,
  deflection: 0,
  exploitation: 0,
  transparency: 0,
  institutionalCost: 0,
  electoralGain: 0,
  personalCost: 0,
  horizon: 0,
  ...o
});
var XP_TAGS = {
  HOUSING_REFORM: ["POLICY", "COMM"],
  PARTY_WHIP: ["NEG"],
  THE_ERROR: ["COMM", "POLICY"],
  ENTRY_23: ["POLICY"],
  FORMATIVE_24: ["ORG"],
  INTRO: ["STRAT"],
  CULVERT: ["POLICY"],
  OPP_CONTRACT: ["STRAT"],
  DISTRICTS: ["POLICY", "STRAT"],
  CROWD_LOUD: ["COMM"],
  CROWD_QUIET: ["COMM"],
  TIP_HOUSING: ["STRAT"],
  GRANT_QUESTION: ["POLICY"],
  SMEAR_RIVAL: ["COMM"],
  RECORDING_DENIABLE: ["STRAT"],
  RECORDING_CLEAN: ["STRAT"],
  ALLY_CONTRACT: ["NEG"],
  AUDIT_OFFICE: ["NEG", "POLICY"],
  PARTY_OFFER: ["NEG"],
  THE_ALLEGATION: ["COMM"],
  THE_TIP: ["STRAT"],
  WILDERNESS: ["STRAT"],
  COMEBACK: ["ORG", "STRAT"],
  CHAIN_HOUSING: ["STRAT"],
  CHAIN_SMEAR: ["COMM"],
  CHAIN_GRANT: ["POLICY"]
};
var DP_GRANTS = {
  FORMATIVE: { n: 3, reason: "Before any of it started" },
  FIRST_CAMPAIGN: { n: 4, reason: "Your first campaign" },
  FIRST_TERM: { n: 4, reason: "Two years in the job" },
  WILDERNESS: { n: 4, reason: "Four years out of office" },
  MIDCAREER: { n: 3, reason: "A decade in politics" }
};
var CAMPAIGN_XP = {
  WON: { tags: ["ORG", "NEG"], label: "Won the ward" },
  LOST: { tags: ["ORG", "ORG", "STRAT", "STRAT"], label: "Lost the ward by four hundred votes" }
};
var LIFE_FOCUS = [
  {
    id: "CONSTITUENCY",
    ability: "ORG",
    label: "The constituency",
    blurb: "Surgeries every Saturday morning. The volunteer list. The streets nobody else knocks."
  },
  {
    id: "COMMITTEE",
    ability: "POLICY",
    label: "The committee corridor",
    blurb: "Bills, briefings, and the detail almost nobody else in the chamber has read."
  },
  {
    id: "PLATFORM",
    ability: "COMM",
    label: "The studio and the platform",
    blurb: "Interviews, panels, debates. Learning to make an argument stand up in ninety seconds."
  },
  {
    id: "CHAMBER_BAR",
    ability: "NEG",
    label: "The bar off the chamber",
    blurb: "The people whose votes you will need one day, and what each of them actually wants."
  },
  {
    id: "BACKROOM",
    ability: "STRAT",
    label: "The back room",
    blurb: "Polling, ward maps, and the long unglamorous business of working out where this is going."
  }
];
var WILDERNESS_TEXT = {
  PROFESSIONAL: "Two years of work that closes at six o'clock. You are better paid than you have ever been and nobody asks your opinion about anything. Twice a year someone recognises you in a queue and cannot place where from.",
  STAFF: "Two years of other people's campaigns. You write the lines, you book the halls, you learn exactly how the nominations are actually decided. Everyone in the building knows your name and no one outside it does.",
  MEDIA: "Two years of the panel show and the Thursday column. You are recognised constantly now, and about half the people who recognise you have already decided what you are. The invitations come from one side only.",
  LOCAL: "Two years of school fetes, drainage meetings and the funeral of anyone who mattered. It is unglamorous and slow and there are four thousand people who would now put your leaflet in their window without being asked.",
  LEAVE: "Two years of not being a politician. It is remarkable, and slightly insulting, how completely a city forgets a person who stops appearing in it. The old scandal stops coming up because nothing about you comes up."
};
var WILDERNESS_PAYOFF = {
  PROFESSIONAL: {
    trait: "competence",
    implication: 0.6,
    strength: 0.8,
    reliability: 0.9,
    diagnosticity: 0.55,
    mediaReach: 0.35
  },
  STAFF: {
    trait: "competence",
    implication: 0.55,
    strength: 0.75,
    reliability: 0.88,
    diagnosticity: 0.5,
    mediaReach: 0.3
  },
  MEDIA: {
    trait: "competence",
    implication: 0.68,
    strength: 0.85,
    reliability: 0.85,
    diagnosticity: 0.6,
    mediaReach: 0.9
  },
  LOCAL: {
    trait: "integrity",
    implication: 0.82,
    strength: 0.9,
    reliability: 0.92,
    diagnosticity: 0.7,
    mediaReach: 0.45
  },
  LEAVE: {
    trait: "competence",
    implication: 0.3,
    strength: 0.3,
    reliability: 0.7,
    diagnosticity: 0.4,
    mediaReach: 0.15
  }
};
var CHAINS = {
  HOUSING: {
    seedId: "TIP_HOUSING",
    outcome: "CONFIRMED",
    seedAge: 30,
    file: "THE NORTHGATE HOUSING FILE",
    reporter: "Mara Venn",
    returnLine: "Mara Venn returns with procurement documents released under appeal."
  },
  SMEAR: {
    seedId: "SMEAR_RIVAL",
    outcome: "DISPROVEN",
    seedAge: 33,
    file: "THE QUALIFICATIONS DOSSIER",
    reporter: "Ilse Brandt",
    returnLine: "Ilse Brandt, who first ran the dossier, files a retraction longer than the original story."
  },
  GRANT: {
    seedId: "GRANT_QUESTION",
    outcome: "UNRESOLVED",
    seedAge: 31,
    file: "THE MERIDIAN CULTURAL GRANT",
    reporter: "the standing inquiry",
    returnLine: "The standing inquiry into the cultural grant finally reports."
  }
};
function chainRecall(spec, credence, move) {
  const said = credence === null || credence === void 0 ? null : [
    "you thought there was nothing in it",
    "you thought it was probably overblown",
    "you thought it was probably real",
    "you were sure it had happened"
  ][credence];
  return {
    file: spec.file,
    header: `${spec.seedAge === 30 ? "Five" : spec.seedAge === 31 ? "Eight" : "Four"} years ago`,
    line: said ? `At ${spec.seedAge}, ${said}.` : `At ${spec.seedAge}, this crossed your desk.`,
    did: move?.label ?? null
  };
}
var CHAIN_TEXT = {
  HOUSING: (v) => ({
    head: "Confirmed, five years late",
    body: "The bank records surface in an unrelated bankruptcy filing. The housing officer took four payments across eighteen months, and the unsigned letter that reached your office at thirty had the dates right.",
    verdict: v.tone === "wrong" ? "You were wrong, and you were wrong early and in writing. A reporter finds the minute where you said so." : v.procedural > 0.5 ? "You did not announce a conclusion. You asked for it to be looked at, and it was, and it was there. Almost nobody notices. One person writes about it." : "You called it before anyone could prove it. That reads as judgment, or as luck, depending on who is describing you."
  }),
  SMEAR: (v) => ({
    head: "The dossier was manufactured",
    body: "The qualifications dossier was forged \u2014 competently, by a former campaign contractor with a grudge and a scanner, who confesses in a civil suit two years later. Every document in it was fabricated.",
    verdict: v.tone === "wrong" ? "You believed it, and some of what you did assumed it was true. The correction travels a fraction as far as the accusation did." : v.procedural > 0.5 ? "You declined to treat it as established before it was established. In hindsight that was the only sensible thing anyone did with it." : "You did not take the bait. Nobody thanks you, because nothing happened."
  }),
  GRANT: () => ({
    head: "Closed without a finding",
    body: "The inquiry into the cultural grant reports after six years. It cannot establish that the foundation received favourable treatment. It also cannot establish that it did not. Two of the three relevant officials have retired; the third declines to be interviewed.",
    verdict: "Nothing is settled and nothing will be. The people who were certain at the time are still certain, in both directions, and the file goes into storage."
  })
};
var RAW_SCRIPT = (P) => [
  {
    id: "INTRO",
    age: 26,
    kind: "story",
    chapter: "Entry",
    title: "The ward that nobody wanted",
    text: `${P.region} has forty thousand people, one flooding culvert, and a council seat the ${BLOCS[P.bloc].name} has lost three times running. The regional secretary offers it to you over bad coffee. "You'd be doing us a favour," she says, which means she expects you to lose.`,
    choices: [
      {
        id: "take",
        flag: "TOOK_SEAT",
        label: "Take the seat. Losing in public is still being in public.",
        features: F({ electoralGain: 0.6, horizon: 0.5 }),
        effect: { capital: 1 }
      },
      {
        id: "bargain",
        label: "Take it \u2014 and make her fund it properly first.",
        features: F({ electoralGain: 0.4, selfProtection: 0.3 }),
        effect: { funds: 3, standing: -1 }
      },
      {
        id: "wait",
        label: "Decline. Ask for the safer ward next cycle.",
        features: F({ selfProtection: 0.7, horizon: 0.3 }),
        effect: { standing: 2, funds: 1, capital: -1 }
      }
    ]
  },
  {
    id: "CULVERT",
    age: 27,
    kind: "story",
    chapter: "Entry",
    responsibility: false,
    title: "The culvert",
    text: "The flooding culvert has been in the budget for nine years and out of it for nine years. Fixing it costs everything you can raise. Announcing you will fix it costs nothing and polls beautifully.",
    choices: [
      { id: "fund", label: "Spend the whole ward fund on the culvert.", features: F({ transparency: 0.4, horizon: 0.9, electoralGain: -0.2 }), effect: { funds: -3, capital: 2 }, flag: "CULVERT_FUNDED" },
      { id: "announce", label: "Announce a plan. Fund a study.", features: F({ deflection: 0.6, electoralGain: 0.7, horizon: -0.3 }), effect: { capital: 1, funds: 3, standing: 1 } },
      { id: "split", label: "Fix the worst hundred metres. Say so plainly.", features: F({ transparency: 0.7, concession: 0.3, horizon: 0.4 }), effect: { funds: -1 }, flag: "CULVERT_PARTIAL" }
    ]
  },
  // ── MATCHED PAIR A, member 1: opposing-side target ──
  {
    id: "OPP_CONTRACT",
    age: 28,
    kind: "judgment",
    chapter: "First term",
    factor: "PARTISAN",
    pairId: "P1",
    level: "OPPOSING_SIDE",
    readFormat: 0,
    title: "A contract on the other side",
    text: `A ${BLOCS[OPP(P.bloc)].name} councillor's brother-in-law won the waste-collection contract for the eastern districts. The procurement file shows two bidders and one very short evaluation window. The councillor says the process was clean and the family connection is a coincidence.`,
    readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
    latents: {
      implication: -0.62,
      strength: 0.62,
      reliability: 0.68,
      diagnosticity: 0.75,
      deniability: 0.2,
      targetSide: "OPPOSING_SIDE",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.7
    },
    choices: [
      { id: "demand", label: "Call for the councillor to stand down while it is investigated.", features: F({ exploitation: 0.7, electoralGain: 0.6, proceduralRestraint: 0.2 }), effect: { capital: 1, standing: 1, funds: 1 } },
      { id: "refer", cost: { capital: 2 }, lockNote: "You have no standing left to spend on asking the Audit Office for favours.", label: "Refer the file to the Audit Office and say nothing else.", features: F({ proceduralRestraint: 0.85, transparency: 0.5, horizon: 0.4 }), effect: { capital: 1 }, institutional: true },
      { id: "quiet", label: "Leave it. Waste contracts are always ugly.", features: F({ deflection: 0.7, horizon: 0.2 }), effect: {} }
    ]
  },
  { id: "ELECTION_1", age: 29, kind: "election", chapter: "First term", office: "Ward Council", tier: 1 },
  // Loss branch — political failure must not be game failure.
  {
    id: "WILDERNESS",
    age: 30,
    kind: "story",
    chapter: "Out",
    when: (st) => !st.office,
    title: "Out",
    text: "You lost by four hundred votes. The party stops returning calls within a fortnight. There is no ceremony to losing a ward seat \u2014 the office is cleared by the end of the month and the phone simply goes quiet.",
    prompt: "Four years is a long time. What do you do with them?",
    choices: [
      {
        id: "professional",
        label: "Go back to the profession. Earn properly for a while.",
        features: F({ selfProtection: 0.4, horizon: -0.1 }),
        effect: { funds: 7 },
        flag: "OUT_PROFESSIONAL",
        out: {
          route: "PROFESSIONAL",
          fade: 2.5,
          recognition: -0.14,
          independence: 0.2,
          note: "You are solvent and nobody can reach you for comment."
        }
      },
      {
        id: "staff",
        label: "Take a job inside the party machine. Be owed things.",
        features: F({ selfProtection: 0.35, electoralGain: 0.5 }),
        effect: { standing: 6, funds: 2 },
        flag: "OUT_STAFF",
        out: {
          route: "STAFF",
          fade: 1,
          recognition: -0.04,
          independence: -0.35,
          note: "The nomination will be easier next time. It will also be theirs to give."
        }
      },
      {
        id: "media",
        label: "Take the column and the panel slot. Be visible.",
        features: F({ exploitation: 0.35, transparency: 0.3 }),
        effect: { funds: 3 },
        flag: "OUT_MEDIA",
        out: {
          route: "MEDIA",
          fade: 0,
          recognition: 0.26,
          independence: 0.1,
          hardens: true,
          note: "Everyone knows who you are now. Half of them have decided what you are."
        }
      },
      {
        id: "local",
        label: "Stay in the ward. Turn up to everything for four years.",
        features: F({ horizon: 0.8, transparency: 0.5 }),
        effect: { capital: 4, standing: 1 },
        flag: "OUT_LOCAL",
        out: {
          route: "LOCAL",
          fade: 0.8,
          recognition: 0.06,
          independence: 0.15,
          local: true,
          note: "Nobody in the capital notices. Four thousand people in the ward do."
        }
      },
      {
        id: "leave",
        label: "Leave politics. Properly, as far as you know.",
        features: F({ deflection: 0.4, horizon: -0.2 }),
        effect: { funds: 5, capital: 1 },
        flag: "OUT_LEAVE",
        out: {
          route: "LEAVE",
          fade: 4,
          recognition: -0.3,
          independence: 0.3,
          note: "It is remarkable how completely the city forgets a person who stops appearing in it."
        }
      }
    ]
  },
  {
    id: "WILDERNESS_MID",
    age: 32,
    kind: "wilderness",
    chapter: "Out",
    when: (st) => !!st.out,
    title: "The middle of it"
  },
  {
    id: "FIRST_TERM",
    age: 32,
    kind: "milestone",
    chapter: "Council",
    when: (st) => !!st.office,
    title: "Two years in",
    grant: "FIRST_TERM",
    text: "Two years of committee papers, ward surgeries and votes you did not get to choose. You have worked out which parts of this job you are actually good at, and which parts you have been getting away with."
  },
  {
    id: "COMEBACK",
    age: 34,
    kind: "story",
    chapter: "Out",
    when: (st) => !!st.out,
    title: "The seat comes open",
    text: "The member who beat you is moving to a national list. The ward selection is open, and your name comes up in the meeting \u2014 not first, but it comes up.",
    prompt: "Do you go back?",
    choices: [
      {
        id: "run",
        label: "Put your name in. You have been waiting four years to be asked.",
        features: F({ electoralGain: 0.6, horizon: 0.4 }),
        effect: { capital: 1 },
        flag: "COMEBACK_RUN"
      },
      {
        id: "run_field",
        requires: { ORG: 55 },
        check: { ability: "ORG", dc: 52 },
        label: "Put your name in, and win it on the doorstep \u2014 four hundred volunteers and no money at all.",
        features: F({ horizon: 0.6, electoralGain: 0.5, transparency: 0.4 }),
        effect: { capital: 2, standing: 1 },
        flag: "COMEBACK_RUN"
      },
      {
        id: "run_hard",
        label: "Put your name in, and make sure the other candidates hear about it first.",
        features: F({ exploitation: 0.55, electoralGain: 0.75 }),
        effect: { standing: 2 },
        flag: "COMEBACK_RUN"
      },
      {
        id: "decline",
        label: "Not this one. Wait for something that is actually yours.",
        features: F({ selfProtection: 0.5, horizon: 0.5 }),
        effect: { funds: 2 },
        flag: "COMEBACK_DECLINE"
      }
    ]
  },
  // ── CHAIN A seed: doubted \u2192 later CONFIRMED ──
  {
    id: "TIP_HOUSING",
    age: 30,
    kind: "judgment",
    chapter: "First term",
    chainSeed: "HOUSING",
    readFormat: 1,
    title: "An unsigned letter",
    text: "Mara Venn at the Northgate Record has been asking about the housing allocations for a month. An unsigned letter reaches your office claiming the district housing officer has been taking payments to move families up the allocation list. It names no dates and attaches no documents. It does name three families, and two of them did move up the list.",
    readPrompt: "Mark your internal confidence for the file. Nobody outside this room sees it.",
    latents: {
      implication: -0.6,
      strength: 0.35,
      reliability: 0.4,
      diagnosticity: 0.7,
      deniability: 0.3,
      targetSide: "NON_PARTISAN",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.3
    },
    choices: [
      { id: "push", label: "Take it to the press. Let the pressure do the work.", features: F({ exploitation: 0.75, electoralGain: 0.5 }), effect: { capital: 1 } },
      { id: "refer", label: "Ask the Audit Office to look at the allocation list quietly.", features: F({ proceduralRestraint: 0.85, horizon: 0.5 }), effect: {}, institutional: true },
      { id: "bin", label: "Anonymous letters are how people settle scores. Bin it.", features: F({ deflection: 0.7 }), effect: {} }
    ]
  },
  // ── CHAIN C seed: never definitively resolves ──
  {
    id: "GRANT_QUESTION",
    age: 31,
    kind: "judgment",
    chapter: "Council",
    chainSeed: "GRANT",
    readFormat: 0,
    title: "The cultural grant",
    text: "The standing inquiry into regional grants opens a file the same week. A foundation with a board full of familiar surnames received the largest cultural grant in the region\u2019s history. The scoring sheet exists, is signed, and awards them four points more than the runner-up on \u201Cinstitutional capacity\u201D. Nobody can say what that means.",
    readPrompt: "Your chief of staff shuts the door. \u201COff the record. What do you actually think happened?\u201D",
    latents: {
      implication: -0.5,
      strength: 0.45,
      reliability: 0.6,
      diagnosticity: 0.55,
      deniability: 0.35,
      targetSide: "NON_PARTISAN",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.5
    },
    choices: [
      { id: "demand", label: "Demand the grant be revoked and rescored.", features: F({ exploitation: 0.6, electoralGain: 0.45 }), effect: { capital: 1, standing: -1 } },
      { id: "inquiry", label: "Call for a formal inquiry and wait for it.", features: F({ proceduralRestraint: 0.85, horizon: 0.6 }), effect: {}, institutional: true },
      { id: "shrug", label: "Every scoring sheet has a soft criterion. Let it go.", features: F({ deflection: 0.65 }), effect: {} }
    ]
  },
  {
    id: "DISTRICTS",
    age: 31,
    kind: "story",
    tradeoff: true,
    when: (st) => !!st.office,
    chapter: "Council",
    temptation: true,
    title: "Two districts, one budget",
    text: "The renewal fund covers one district. The northern district has the worse flooding, the older pipes and the smaller turnout. The southern district decides your re-election. Both allocations are entirely legal and both have a written case.",
    choices: [
      { id: "need", label: "North. The need is measurable and the case is on paper.", features: F({ transparency: 0.6, horizon: 0.8, electoralGain: -0.6 }), effect: { capital: 2, funds: -1, standing: -1 }, flag: "CHOSE_NEED", stakes: { core: -0.32, ind: 0.22, publicSector: 0.15 } },
      { id: "survive", label: "South. You cannot fix anything from outside the chamber.", features: F({ electoralGain: 0.85, selfProtection: 0.5, horizon: -0.2 }), effect: { funds: 3, standing: 2 }, flag: "CHOSE_SURVIVAL", stakes: { core: 0.35, ind: -0.22, owner: 0.12 } },
      { id: "split", label: "Split it. Half a fix in both places.", features: F({ deflection: 0.4, concession: 0.2, electoralGain: 0.2 }), effect: { funds: 1 }, flag: "CHOSE_SPLIT", stakes: { core: 0.05, ind: -0.05 } }
    ]
  },
  // ── MATCHED PAIR B, member 1: loud crowd ──
  {
    // TRADE-OFF 1 — good policy, bad politics. Owners lose, renters gain, and no option
    // is clean. Communication changes how badly it lands; it cannot make the loss vanish.
    id: "HOUSING_REFORM",
    age: 31,
    kind: "story",
    chapter: "Council",
    when: (st) => !!st.office,
    tradeoff: true,
    responsibility: true,
    title: "The density map",
    text: "The ward has four thousand people on the housing list and a planning rule that has not changed since 1974. Lifting it would put three hundred new flats on the eastern approach within four years. It would also put them behind eleven hundred houses whose owners have spent thirty years believing that view was part of what they bought.",
    prompt: "The vote is yours to lead or to bury.",
    choices: [
      {
        id: "full",
        label: "Lead it. Full rezoning, and stand up at the meeting to defend it.",
        features: F({ transparency: 0.8, horizon: 0.9, personalCost: 0.8, electoralGain: -0.7 }),
        check: { ability: "COMM", dc: 58 },
        effect: { capital: 1 },
        stakes: { owner: -0.55, young: 0.45, business: 0.15, core: -0.1 },
        signal: { implication: 0.35, trait: "competence", strength: 0.7 },
        flag: "HOUSING_FULL"
      },
      {
        id: "phased",
        label: "Phase it over eight years so the first tranche lands after the election.",
        features: F({ horizon: 0.5, deflection: 0.3, electoralGain: 0.2, proceduralRestraint: 0.3 }),
        check: { ability: "POLICY", dc: 55 },
        effect: { capital: 1 },
        stakes: { owner: -0.2, young: 0.15 },
        signal: { implication: 0.12, trait: "competence", strength: 0.5 },
        flag: "HOUSING_PHASED"
      },
      {
        id: "consult",
        label: "Send it to consultation. Consultations take two years and produce a document.",
        features: F({ deflection: 0.8, selfProtection: 0.5, horizon: -0.4 }),
        effect: { standing: 1 },
        stakes: { owner: 0.25, young: -0.35 },
        flag: "HOUSING_BURIED"
      },
      {
        id: "kill",
        label: "Kill it and say plainly that you are protecting the character of the ward.",
        features: F({ electoralGain: 0.6, selfProtection: 0.4, horizon: -0.6, transparency: 0.4 }),
        effect: { standing: 4, funds: 5 },
        stakes: { owner: 0.5, young: -0.5, business: -0.1 },
        flag: "HOUSING_KILLED"
      }
    ]
  },
  {
    // TRADE-OFF 4 — party against principle. Negotiation decides what you get out of it,
    // not whether the conflict exists.
    id: "PARTY_WHIP",
    age: 34,
    kind: "story",
    chapter: "Rising",
    tradeoff: true,
    title: "A three-line whip",
    text: "The bloc is going to vote for a procurement bill that removes the audit threshold on contracts under two million. You have read it twice. It is a bad bill and everyone privately knows it is a bad bill; it is also the price of a housing package your ward has waited six years for.",
    prompt: "The whip wants an answer before six.",
    choices: [
      {
        id: "rebel",
        label: "Vote against it and say why on the record.",
        features: F({ transparency: 0.85, proceduralRestraint: 0.6, personalCost: 0.8, electoralGain: -0.3 }),
        effect: { standing: -4, capital: 1 },
        check: { ability: "COMM", dc: 55 },
        stakes: { core: -0.15, ind: 0.2, publicSector: 0.2 },
        flag: "REBELLED"
      },
      {
        id: "trade",
        label: "Trade your vote \u2014 support it, and take the housing package in writing.",
        features: F({ proceduralRestraint: 0.2, institutionalCost: 0.45, horizon: 0.55, electoralGain: 0.4 }),
        effect: { standing: 3, capital: 2 },
        check: { ability: "NEG", dc: 56 },
        stakes: { core: 0.2, young: 0.22, publicSector: -0.28, ind: -0.15 },
        flag: "TRADED_VOTE"
      },
      {
        id: "abstain",
        label: "Abstain, and let it pass without your name on it.",
        features: F({ deflection: 0.8, selfProtection: 0.6, institutionalCost: 0.25 }),
        effect: { standing: -1 },
        stakes: { ind: -0.14, core: -0.12, publicSector: 0.08 },
        flag: "ABSTAINED"
      },
      {
        id: "support",
        label: "Vote for it and defend it in public as a sensible simplification.",
        features: F({ selfProtection: 0.4, institutionalCost: 0.6, electoralGain: 0.35, deflection: 0.5 }),
        effect: { standing: 6, funds: 4 },
        check: { ability: "COMM", dc: 52 },
        stakes: { core: 0.15, publicSector: -0.25 },
        flag: "WHIPPED"
      }
    ]
  },
  {
    // TRADE-OFF 5 — your own administration's error. Concealment can genuinely work; the
    // seed decided years ago whether it surfaces, so this is not karma.
    id: "THE_ERROR",
    age: 36,
    kind: "story",
    chapter: "Rising",
    tradeoff: true,
    responsibility: true,
    when: (st) => !!st.office,
    title: "Nine months of the wrong number",
    text: "Your office has been publishing a school-meals uptake figure that is wrong. Not fraudulently wrong \u2014 a spreadsheet inherited from the previous administration double-counted a category \u2014 but you have cited it four times, including once to justify a budget you won. Three people know. The press does not.",
    prompt: "Nobody is going to make this decision for you.",
    choices: [
      {
        id: "disclose",
        label: "Publish the correction today, with the four occasions you used it listed.",
        features: F({ transparency: 0.95, concession: 0.8, personalCost: 0.8, electoralGain: -0.4 }),
        check: { ability: "COMM", dc: 56 },
        effect: {},
        stakes: { ind: 0.25, publicSector: 0.2, core: -0.3 },
        signal: { implication: -0.28, trait: "competence", strength: 0.6 },
        flag: "ERROR_DISCLOSED"
      },
      {
        id: "audit",
        label: "Have the audit office look at it first, then publish whatever they find.",
        features: F({ proceduralRestraint: 0.85, transparency: 0.5, horizon: 0.5 }),
        cost: { capital: 2 },
        lockNote: "You have nothing left to spend on asking the audit office for anything.",
        check: { ability: "POLICY", dc: 54 },
        stakes: { ind: 0.16, publicSector: 0.16, core: -0.14, opp: -0.1 },
        flag: "ERROR_AUDITED"
      },
      {
        id: "quiet",
        label: "Correct the figure quietly in the next routine release and say nothing.",
        features: F({ deflection: 0.7, selfProtection: 0.5, electoralGain: 0.2 }),
        effect: { funds: 3, standing: 2 },
        stakes: {},
        flag: "ERROR_BURIED"
      },
      {
        id: "blame",
        label: "Correct it, and make clear it was inherited from the previous administration.",
        features: F({ selfProtection: 0.8, deflection: 0.6, exploitation: 0.4, electoralGain: 0.35 }),
        check: { ability: "COMM", dc: 50 },
        effect: { standing: 4, funds: 2 },
        stakes: { core: 0.2, opp: -0.2 },
        flag: "ERROR_BLAMED"
      }
    ]
  },
  {
    id: "CROWD_LOUD",
    age: 32,
    kind: "judgment",
    chapter: "Council",
    factor: "CROWD",
    pairId: "C1",
    level: "CROWD_HIGH",
    readFormat: 1,
    title: "The school-meals contractor",
    text: "A photograph circulates showing the school-meals contractor at a private dinner with the procurement officer who approved her renewal. It is a photograph of a dinner. Nothing else has surfaced. Forty thousand shares by lunchtime, and the reply column is a wall of fury.",
    readPrompt: "Mark your internal confidence for the file. Nobody outside this room sees it.",
    latents: {
      implication: -0.45,
      strength: 0.4,
      reliability: 0.55,
      diagnosticity: 0.5,
      deniability: 0.25,
      targetSide: "NON_PARTISAN",
      sourceAlignment: "NEUTRAL",
      crowd: { direction: -1, magnitude: 0.85, independence: 0.25 },
      mediaReach: 0.95,
      salience: 0.3
    },
    salience: 0.9,
    choices: [
      { id: "ride", label: "Amplify. The anger is already there and it is pointed the right way.", features: F({ exploitation: 0.85, electoralGain: 0.7, horizon: -0.4 }), effect: { capital: 1, funds: 1 } },
      { id: "process", check: { ability: "COMM", dc: 54 }, label: "Ask the council to review the contract properly, and say the photo is not evidence.", features: F({ proceduralRestraint: 0.8, transparency: 0.6, electoralGain: -0.4 }), effect: { capital: 1, standing: -1 }, institutional: true },
      { id: "silent", label: "Say nothing. It will burn out.", features: F({ deflection: 0.75 }), effect: {} }
    ]
  },
  {
    id: "CULVERT_RESULT",
    age: 33,
    kind: "consequence",
    chapter: "Council",
    title: "Second storm",
    resolve: (st) => st.flags.CULVERT_FUNDED ? { text: "The culvert holds. Four streets that flooded in your first year stay dry, and the local paper runs a photograph of the outflow that nobody outside the ward will ever care about. You care about it.", event: { implication: 0.55, strength: 0.7, reliability: 0.9, diagnosticity: 0.7, deniability: 0, trait: "competence", targetSide: "PLAYER_SIDE", sourceAlignment: "NEUTRAL", crowd: null, mediaReach: 0.55 } } : st.flags.CULVERT_PARTIAL ? { text: "The repaired hundred metres holds. The rest does not. Two streets flood, and because you said plainly what you were doing, nobody accuses you of lying about it.", event: { implication: 0.1, strength: 0.5, reliability: 0.85, diagnosticity: 0.5, deniability: 0, trait: "competence", targetSide: "PLAYER_SIDE", sourceAlignment: "NEUTRAL", crowd: null, mediaReach: 0.6 } } : { text: "The study is eleven months from publication. The culvert is not. Six streets flood, and a resident reads your announcement aloud to a television camera standing in her kitchen.", event: { implication: -0.6, strength: 0.9, reliability: 0.92, diagnosticity: 0.65, deniability: 0, trait: "competence", targetSide: "PLAYER_SIDE", sourceAlignment: "NEUTRAL", crowd: { direction: -1, magnitude: 0.5, independence: 0.3 }, mediaReach: 0.8 } }
  },
  // ── CHAIN B seed: accepted \u2192 later DISPROVEN ──
  {
    id: "SMEAR_RIVAL",
    age: 33,
    kind: "judgment",
    chapter: "Council",
    chainSeed: "SMEAR",
    readFormat: 0,
    title: "The qualifications dossier",
    text: `Ilse Brandt runs it first, under her own byline, and the others follow within the hour. A dossier reaches three newsrooms and your office on the same morning. It says the ${BLOCS[OPP(P.bloc)].name} candidate for mayor never completed the degree she has claimed for twenty years. It contains registry printouts, a letter on university paper and a statutory declaration. On its face it looks extremely solid.`,
    readPrompt: "Your chief of staff shuts the door. \u201COff the record. What do you actually think happened?\u201D",
    latents: {
      implication: -0.7,
      strength: 0.75,
      reliability: 0.72,
      diagnosticity: 0.7,
      deniability: 0.2,
      targetSide: "OPPOSING_SIDE",
      sourceAlignment: "ALIGNED",
      crowd: null,
      mediaReach: 0.8,
      salience: 0.2
    },
    salience: 0.7,
    choices: [
      { id: "run", label: "Put it out. Documents are documents.", features: F({ exploitation: 0.9, electoralGain: 0.8, horizon: -0.5 }), effect: { capital: 1, funds: 2 }, flag: "RAN_SMEAR", hitsRival: 0.6 },
      { id: "verify", label: "Have the registry contacted directly before anyone says a word.", features: F({ proceduralRestraint: 0.9, transparency: 0.5, electoralGain: -0.4, horizon: 0.6 }), effect: { funds: -1 }, institutional: true },
      { id: "pass", label: "Refuse it. A degree from 1998 is not why anyone should lose.", features: F({ proceduralRestraint: 0.5, personalCost: 0.4, electoralGain: -0.5 }), effect: { capital: 1 } }
    ]
  },
  // ── MATCHED PAIR B, member 2: same evidence, no crowd ──
  {
    id: "CROWD_QUIET",
    age: 34,
    kind: "judgment",
    chapter: "Council",
    factor: "CROWD",
    pairId: "C1",
    level: "CROWD_LOW",
    readFormat: 1,
    title: "The transport consultancy",
    text: "A photograph reaches your office showing the transport consultancy's director at a private dinner with the officer who renewed her framework agreement. It is a photograph of a dinner. Nothing else has surfaced. It has been sitting in a local reporter's drafts folder for a week and nobody has picked it up.",
    readPrompt: "Mark your internal confidence for the file. Nobody outside this room sees it.",
    latents: {
      implication: -0.45,
      strength: 0.4,
      reliability: 0.55,
      diagnosticity: 0.5,
      deniability: 0.25,
      targetSide: "NON_PARTISAN",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.35
    },
    choices: [
      { id: "push", label: "Push it to the press yourself.", features: F({ exploitation: 0.8, electoralGain: 0.5 }), effect: {} },
      { id: "process", label: "Ask for a proper review of the framework agreement.", features: F({ proceduralRestraint: 0.8, transparency: 0.55 }), effect: { capital: 1 }, institutional: true },
      { id: "silent", label: "Nothing here worth acting on.", features: F({ deflection: 0.6 }), effect: {} }
    ]
  },
  { id: "CHAIN_HOUSING", age: 35, kind: "chain", chapter: "Rising", chain: "HOUSING" },
  // ── MATCHED PAIR C, member 1: high deniability ──
  {
    id: "RECORDING_DENIABLE",
    age: 35,
    kind: "judgment",
    chapter: "Rising",
    factor: "DENIABILITY",
    pairId: "D1",
    level: "DEN_HIGH",
    readFormat: 0,
    title: "Forty-one seconds",
    text: "A forty-one second recording surfaces of the regional housing chair apparently agreeing to move a rezoning decision in exchange for a favour. The chair says the audio is synthetic and has hired a firm that says so too. A different firm says it cannot tell. Nobody can produce the original file.",
    readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
    latents: {
      implication: -0.75,
      strength: 0.7,
      reliability: 0.6,
      diagnosticity: 0.8,
      deniability: 0.8,
      targetSide: "NON_PARTISAN",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.85
    },
    choices: [
      { id: "treat", label: "Treat it as real until someone proves otherwise.", features: F({ exploitation: 0.6, electoralGain: 0.4 }), effect: {} },
      { id: "forensic", cost: { funds: 4 }, lockNote: "Your campaign cannot currently fund an external review.", label: "Fund an independent forensic examination before anyone says anything.", features: F({ proceduralRestraint: 0.85, transparency: 0.6, horizon: 0.5 }), effect: { funds: -1, capital: 1 }, institutional: true },
      { id: "dismiss", label: "Say publicly that unverifiable audio should not end careers.", features: F({ proceduralRestraint: 0.4, deflection: 0.4 }), effect: {} }
    ]
  },
  // The player has been judging other people for ten years. Now it is their turn.
  // This is also the only event that gives the four cognitive mechanisms real work
  // to do on the player's own reputation.
  {
    id: "THE_ALLEGATION",
    age: 36,
    pressure: 8,
    kind: "story",
    chapter: "Rising",
    responsibility: true,
    title: "Your turn",
    text: "A " + BLOCS[OPP(P.bloc)].name + "-aligned outlet reports that your first campaign accepted eleven thousand from a construction firm that won a resurfacing contract fourteen months later. Both facts are true. The connection between them is asserted, not shown. By evening it is the only thing anyone wants to ask you about.",
    salience: 1,
    abilityOption: "COMM",
    playerAllegation: {
      implication: -0.72,
      strength: 0.55,
      reliability: 0.62,
      diagnosticity: 0.75,
      deniability: 0.4,
      trait: "integrity",
      targetSide: "PLAYER_SIDE",
      sourceAlignment: "OPPOSED",
      crowd: { direction: -1, magnitude: 0.8, independence: 0.25 },
      mediaReach: 0.95,
      salience: 0.5
    },
    choices: [
      {
        id: "open_meeting",
        requires: { COMM: 55 },
        check: { ability: "COMM", dc: 60 },
        label: "Book the biggest hall in the ward, invite the reporter, and take questions until they stop.",
        features: F({ transparency: 0.9, concession: 0.2, personalCost: 0.7, electoralGain: -0.1 }),
        effect: { capital: 2 }
      },
      {
        id: "disclose",
        label: "Publish every donation and every contract from that year. All of it.",
        features: F({ transparency: 0.95, concession: 0.4, personalCost: 0.6, electoralGain: -0.2, horizon: 0.7 }),
        effect: { capital: 2, standing: -2 }
      },
      {
        id: "ethics",
        label: "Refer yourself to the ethics committee and stop commenting.",
        features: F({ proceduralRestraint: 0.9, transparency: 0.4, personalCost: 0.4, electoralGain: -0.35 }),
        effect: { capital: 1, standing: -1 },
        institutional: true
      },
      {
        id: "deny",
        label: "Attack the outlet. It is a smear and its owner is on the other side.",
        features: F({ selfProtection: 0.9, deflection: 0.6, exploitation: 0.4, electoralGain: 0.3 }),
        effect: { standing: 2, funds: 1 }
      },
      {
        id: "settle",
        label: "Return the money quietly and say nothing.",
        features: F({ deflection: 0.7, concession: 0.3, selfProtection: 0.4 }),
        effect: { funds: -2 }
      }
    ]
  },
  // ── MATCHED PAIR A, member 2: own-side target, same latents as OPP_CONTRACT ──
  {
    id: "ALLY_CONTRACT",
    age: 36,
    kind: "judgment",
    chapter: "Rising",
    responsibility: false,
    factor: "PARTISAN",
    pairId: "P1",
    level: "PLAYER_SIDE",
    readFormat: 0,
    title: "A contract on your side",
    text: `A ${BLOCS[P.bloc].name} councillor you have worked beside for six years has a brother-in-law who won the waste-collection contract for the western districts. The procurement file shows two bidders and one very short evaluation window. She tells you, personally, that the process was clean and the family connection is a coincidence.`,
    readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
    latents: {
      implication: -0.62,
      strength: 0.62,
      reliability: 0.68,
      diagnosticity: 0.75,
      deniability: 0.2,
      targetSide: "PLAYER_SIDE",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.7
    },
    choices: [
      { id: "demand", check: { ability: "COMM", dc: 58 }, label: "Say publicly that she should stand down while it is investigated.", features: F({ concession: 0.7, transparency: 0.7, electoralGain: -0.5, personalCost: 0.6 }), effect: { standing: -3, capital: 1 } },
      { id: "refer", cost: { capital: 2 }, lockNote: "You have no standing left to spend on asking the Audit Office for favours.", label: "Refer the file to the Audit Office and say nothing else.", features: F({ proceduralRestraint: 0.85, transparency: 0.5, horizon: 0.4 }), effect: { standing: -1 }, institutional: true },
      { id: "shield", label: "Back her publicly. You have seen the woman work.", features: F({ selfProtection: 0.6, deflection: 0.6, electoralGain: 0.2 }), effect: { standing: 3, funds: 1 } }
    ]
  },
  { id: "CHAIN_SMEAR", age: 37, kind: "chain", chapter: "Rising", chain: "SMEAR" },
  {
    id: "PARTY_OFFER",
    age: 33,
    kind: "story",
    chapter: "The offer",
    measurement: "NONE",
    title: "The call from the capital",
    text: "The deputy leader wants you in the capital as a policy spokesperson. It is a real job with a real staff and it is two hundred miles from the only place that has ever voted for you. She does not say what she wants in return, because people at her level do not have to.",
    prompt: "You have until Friday.",
    choices: [
      {
        id: "accept",
        label: "Accept. The capital is where things are decided.",
        features: F({ electoralGain: 0.5, horizon: 0.3 }),
        effect: { standing: 5, funds: 4, capital: 1 },
        flag: "CAPITAL_ROLE",
        career: { independence: -0.4, recognition: 0.18, local: -0.15 }
      },
      {
        id: "accept_with_people",
        requires: { NEG: 55 },
        check: { ability: "NEG", dc: 54 },
        label: "Accept \u2014 and bring two of your own people into the office with you.",
        features: F({ proceduralRestraint: 0.3, electoralGain: 0.55, horizon: 0.7 }),
        effect: { standing: 4, funds: 3, capital: 2 },
        flag: "CAPITAL_ROLE",
        career: { independence: -0.15, recognition: 0.16 }
      },
      {
        id: "conditional",
        label: "Accept, on the condition that you keep the ward and your own line on housing.",
        features: F({ proceduralRestraint: 0.4, transparency: 0.35, horizon: 0.5 }),
        effect: { standing: 2, funds: 2 },
        flag: "CAPITAL_CONDITIONAL",
        career: { independence: -0.1, recognition: 0.1 }
      },
      {
        id: "decline",
        label: "Decline. Build something here that is yours.",
        features: F({ horizon: 0.7, selfProtection: 0.2 }),
        effect: { capital: 3 },
        flag: "STAYED_LOCAL",
        career: { independence: 0.25, recognition: -0.04, local: 0.15 }
      },
      {
        id: "refuse_loudly",
        label: "Decline, and say publicly that the capital has stopped listening to wards like yours.",
        features: F({ exploitation: 0.45, transparency: 0.5, institutionalCost: 0.25 }),
        effect: { capital: 2, standing: -3 },
        flag: "BURNED_BRIDGE",
        career: { independence: 0.45, recognition: 0.22, local: 0.2 }
      }
    ]
  },
  {
    id: "AUDIT_OFFICE",
    age: 37,
    kind: "story",
    when: (st) => !!st.office,
    chapter: "Rising",
    institutional: true,
    responsibility: true,
    title: "The Audit Office asks for more",
    text: "The Audit Office wants standing access to departmental procurement records without prior notice. It would make your own next four years considerably less comfortable, and it would survive you by decades. The vote is close and your bloc is looking at you.",
    choices: [
      { id: "grant", check: { ability: "NEG", dc: 56 }, label: "Support it in full.", features: F({ proceduralRestraint: 0.95, transparency: 0.85, horizon: 0.9, personalCost: 0.7, electoralGain: -0.3 }), effect: { standing: -3, capital: 2 } },
      { id: "narrow", label: "Support it, with a notice period.", features: F({ proceduralRestraint: 0.5, transparency: 0.4, institutionalCost: 0.35, horizon: 0.3 }), effect: { capital: 1 } },
      {
        id: "narrow_amendment",
        requires: { POLICY: 58 },
        check: { ability: "POLICY", dc: 55 },
        label: "Draft an amendment: full access, but a standing carve-out for live investigations \u2014 and get it through.",
        features: F({ proceduralRestraint: 0.75, transparency: 0.6, institutionalCost: 0.15, horizon: 0.75, personalCost: 0.3 }),
        effect: { capital: 3 }
      },
      { id: "block", label: "Block it. The office already has enough.", features: F({ selfProtection: 0.8, institutionalCost: 0.85, electoralGain: 0.4, horizon: -0.5 }), effect: { standing: 3, funds: 2 } }
    ]
  },
  // ── MATCHED PAIR C, member 2: same evidence, low deniability ──
  {
    id: "RECORDING_CLEAN",
    age: 38,
    kind: "judgment",
    chapter: "Rising",
    factor: "DENIABILITY",
    pairId: "D1",
    level: "DEN_LOW",
    readFormat: 0,
    title: "Forty-four seconds",
    text: "A forty-four second recording surfaces of the regional licensing chair apparently agreeing to move a permit decision in exchange for a favour. The original file was handed over by the person who made it, with the device, and two independent laboratories have examined it and found no sign of editing.",
    readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
    latents: {
      implication: -0.75,
      strength: 0.7,
      reliability: 0.6,
      diagnosticity: 0.8,
      deniability: 0.05,
      targetSide: "NON_PARTISAN",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: 0.85
    },
    choices: [
      { id: "treat", label: "Say publicly that it is authentic and should be acted on.", features: F({ transparency: 0.6, electoralGain: 0.3 }), effect: {} },
      { id: "forensic", label: "Wait for the licensing committee to complete its own process.", features: F({ proceduralRestraint: 0.8, horizon: 0.4 }), effect: { capital: 1 }, institutional: true },
      { id: "dismiss", label: "Note that recordings can mislead even when they are real.", features: F({ deflection: 0.6 }), effect: {} }
    ]
  },
  { id: "CHAIN_GRANT", age: 39, kind: "chain", chapter: "The run", chain: "GRANT" },
  {
    id: "THE_TIP",
    age: 39,
    tradeoff: true,
    kind: "story",
    chapter: "The run",
    temptation: true,
    title: "Eleven days out",
    text: "Eleven days before the vote, a folder reaches your campaign. It suggests your opponent's foundation moved money it should not have moved. It is unverified. Verifying it properly would take three weeks you do not have. Using it would probably decide the election.",
    choices: [
      { id: "verify", cost: { funds: 3 }, lockNote: "Verification costs money you do not have eleven days out.", label: "Try to verify it. Say nothing until you can.", features: F({ proceduralRestraint: 0.9, transparency: 0.5, electoralGain: -0.7, horizon: 0.7 }), effect: { funds: -2 }, flag: "TIP_VERIFY", stakes: { core: -0.15, ind: 0.2 } },
      {
        id: "read_it",
        requires: { STRAT: 58 },
        label: "Before deciding anything: have your analyst take the folder apart overnight.",
        features: F({ proceduralRestraint: 0.65, horizon: 0.5 }),
        effect: {},
        flag: "TIP_ANALYSED",
        strategyRead: true
      },
      { id: "hint", label: 'Say there are "serious questions" without making the claim.', features: F({ exploitation: 0.6, deflection: 0.5, electoralGain: 0.6 }), effect: {}, flag: "TIP_HINT", hitsRival: 0.35, stakes: { core: 0.18, ind: -0.12 } },
      { id: "attack", label: "Use it. Attribute it. Let them deny it.", features: F({ exploitation: 0.95, electoralGain: 0.85, horizon: -0.6 }), effect: { capital: 1 }, flag: "TIP_ATTACK", hitsRival: 0.75, stakes: { core: 0.3, ind: -0.25, opp: -0.2 } },
      { id: "refuse", label: "Destroy the folder and tell the campaign it never arrived.", features: F({ proceduralRestraint: 0.8, personalCost: 0.5, electoralGain: -0.6, horizon: 0.6 }), effect: { capital: 1 }, flag: "TIP_REFUSE" }
    ]
  },
  {
    id: "TIP_FALLOUT",
    age: 40,
    kind: "fallout",
    chapter: "The run",
    when: (st) => !!(st.flags.TIP_ATTACK || st.flags.TIP_HINT)
  },
  { id: "ELECTION_2", age: 40, kind: "election", chapter: "The run", office: "City Mayor", tier: 2 }
];
var EARLY_SCRIPT = (P) => [
  {
    id: "ENTRY_23",
    age: 23,
    kind: "story",
    chapter: "Before",
    title: "The first office",
    text: ROUTE_ENTRY[P.route] || ROUTE_ENTRY.CIVIC,
    prompt: "Two months in, you notice something.",
    choices: [
      {
        id: "raise",
        label: "Say it out loud in the Monday meeting.",
        features: F({ transparency: 0.8, personalCost: 0.4, proceduralRestraint: 0.3 }),
        effect: { capital: 2 },
        check: { ability: "COMM", dc: 40 },
        xp: ["COMM"]
      },
      {
        id: "memo",
        label: "Put it in writing to one person who can act on it.",
        features: F({ proceduralRestraint: 0.7, transparency: 0.4, horizon: 0.4 }),
        effect: { capital: 1, standing: 1 },
        check: { ability: "POLICY", dc: 40 },
        xp: ["POLICY"]
      },
      {
        id: "useful",
        label: "Say nothing, and make yourself useful to the person it protects.",
        features: F({ selfProtection: 0.6, electoralGain: 0.4, deflection: 0.4 }),
        effect: { standing: 3, funds: 1 },
        xp: ["NEG"]
      }
    ]
  },
  {
    id: "FORMATIVE_24",
    age: 24,
    kind: "story",
    chapter: "Before",
    title: "The night they lose",
    text: "Your side loses the regional election by nine hundred votes. At two in the morning the room is looking for someone to blame, and the campaign manager is drunk and specific about it. Somebody has to talk to the volunteers who gave up four months of their lives.",
    prompt: "You are the most junior person still standing.",
    choices: [
      {
        id: "speak",
        label: "Get up on a chair and thank them by name until you run out of names.",
        features: F({ transparency: 0.6, horizon: 0.5 }),
        effect: { capital: 2 },
        check: { ability: "COMM", dc: 42 },
        xp: ["COMM", "ORG"]
      },
      {
        id: "numbers",
        label: "Go and find out where the nine hundred votes actually went.",
        features: F({ proceduralRestraint: 0.4, horizon: 0.7 }),
        effect: { capital: 1 },
        check: { ability: "STRAT", dc: 42 },
        xp: ["STRAT", "STRAT"]
      },
      {
        id: "list",
        label: "Take the volunteer list home. These are the only people who will ever knock for you.",
        features: F({ electoralGain: 0.5, horizon: 0.6 }),
        effect: { standing: 1, funds: 1 },
        xp: ["ORG", "ORG"]
      }
    ]
  },
  {
    id: "FORMATIVE_FOCUS",
    age: 25,
    kind: "milestone",
    chapter: "Before",
    grant: "FORMATIVE",
    text: "You are twenty-five and nobody is going to hand you anything. Whatever you spend the next two years getting good at is the thing you will be, when it eventually matters."
  }
];
var ROUTE_ENTRY = {
  STAFF: "You are twenty-three and you answer a member's correspondence for a salary that does not cover the room you rent. You have read every bill that passed this session because nobody else in the office has time to.",
  CIVIC: "You are twenty-three and you run a tenants' association out of a room above a laundrette. Forty households, one damp problem the council will not name, and a phone that rings at eleven at night.",
  PROF: "You are twenty-three and you check municipal procurement files for a living. It is the least glamorous job in the building and it is the only one where you get to read everything."
};
var SCRIPT = (P) => [...EARLY_SCRIPT(P), ...RAW_SCRIPT(P)].map((b, i) => ({ b, i })).sort((x, y) => x.b.age - y.b.age || x.i - y.i).map((x) => x.b);

// src/playtest.mjs
var PLAYTEST_SEEDS = {
  natural: {
    seed: null,
    label: "Natural seed",
    note: "A random world. What an ordinary player gets."
  },
  defeat: {
    seed: "POL-003K",
    label: "Forced early defeat",
    note: "Most scripted styles lose the first election here, and every one of those runs finds a way back. Re-hunted for v0.37: the formative years leave players stronger, so no seed defeats every style any more."
  },
  close: {
    seed: "POL-001J",
    label: "Competitive",
    note: "Across the shipped backgrounds and styles, only one run loses the first election; mayoral results span 15.7 points and one lands at 49.72%. Choices decide it."
  },
  strong: {
    seed: "POL-001Q",
    label: "Strong opponent",
    note: "A true STRONG-rival world. Twelve of eighteen runs lose first, four still win the mayoralty, and four of the twelve defeated runs find a comeback."
  }
};
function resolveTestMode(raw) {
  const k = String(raw || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLAYTEST_SEEDS, k) ? k : null;
}
var SURVEY = [
  {
    id: "q1",
    type: "scale7",
    q: "How much did you want to keep playing until the end?",
    lo: "Wanted to stop",
    hi: "Wanted to keep going"
  },
  { id: "q2", type: "text", q: "At what point, if any, did the game start to feel repetitive?" },
  { id: "q3", type: "text", q: "Which decision was hardest to make?" },
  {
    id: "q4",
    type: "yesno_text",
    q: 'Did any choice feel like it had an obvious "correct answer"?',
    followUp: "Which one?"
  },
  {
    id: "q5",
    type: "choice",
    q: "When an old case returned years later, did you remember the original event?",
    options: ["Yes, clearly", "Vaguely", "No"]
  },
  {
    id: "q6",
    type: "choice",
    q: "If you lost an election: did losing make you want to continue?",
    options: ["More", "Same", "Less", "Not applicable"]
  },
  {
    id: "q7",
    type: "choice",
    q: "How did the locked resource options feel?",
    options: ["A meaningful constraint", "Frustrating", "Confusing", "Barely noticed them"]
  },
  {
    id: "q8",
    type: "scale7",
    q: "Did the Mini Mirror feel specific to your choices?",
    lo: "Could be anyone",
    hi: "Specifically me"
  },
  { id: "q9", type: "text", q: "Did anything in the Mirror surprise you?" },
  {
    id: "q10",
    type: "scale7_na",
    q: "Did the Counterfactual Audit help you understand why voters reacted differently?",
    lo: "Not at all",
    hi: "A lot",
    na: "I did not open it"
  },
  {
    id: "q11",
    type: "scale7",
    q: "After playing, how interested are you in living another political life?",
    lo: "Not at all",
    hi: "Very"
  },
  { id: "q12", type: "text", q: "What single thing would make you want to play again?" },
  // ── ability section (v0.36 build only) ──
  {
    id: "q13",
    type: "scale7",
    section: "ability",
    q: "Did developing your politician make the game feel more like a political life?",
    lo: "Not at all",
    hi: "Very much"
  },
  {
    id: "q14",
    type: "choice",
    section: "ability",
    q: "Did the development choices feel like career decisions, or like a stat menu?",
    options: [
      "Strongly like career decisions",
      "Somewhat like career decisions",
      "Mixed",
      "Somewhat like stat allocation",
      "Strongly like stat allocation"
    ]
  },
  {
    id: "q15",
    type: "multitext",
    section: "ability",
    q: "Without looking back: what do you think each of these actually does?",
    fields: ["Public Communication", "Policy & Governance", "Organization", "Negotiation", "Political Strategy"]
  },
  {
    id: "q16",
    type: "choice",
    section: "ability",
    q: "Which ability felt most useful in your run?",
    options: ["Public Communication", "Policy & Governance", "Organization", "Negotiation", "Political Strategy", "None stood out"]
  },
  {
    id: "q17",
    type: "choice",
    section: "ability",
    q: "Which ability felt least noticeable?",
    options: ["Public Communication", "Policy & Governance", "Organization", "Negotiation", "Political Strategy", "They all registered"]
  },
  {
    id: "q18",
    type: "scale7",
    section: "ability",
    q: "Did you understand why some development choices produced more growth than others?",
    lo: "No idea",
    hi: "Completely clear"
  },
  {
    id: "q19",
    type: "choice",
    section: "ability",
    q: "Some things came more naturally to your politician than others. That felt:",
    options: ["Interesting", "Confusing", "Unfair", "Barely noticed it", "Not sure"]
  },
  {
    id: "q20",
    type: "yesno_text",
    section: "ability",
    q: 'Did any option you could not take make you think "I wish I had developed differently"?',
    followUp: "Which moment?"
  },
  {
    id: "q21",
    type: "scale7_text",
    section: "ability",
    q: "Did the development screen ever interrupt the feeling of living a political life?",
    lo: "Never",
    hi: "Constantly",
    followUp: "Anything you want to add?"
  },
  {
    id: "q22",
    type: "scale7",
    section: "ability",
    q: "If you played again, would you deliberately build a different kind of politician?",
    lo: "Same again",
    hi: "Definitely different"
  }
];
var ABILITY_SURVEY_IDS = SURVEY.filter((q) => q.section === "ability").map((q) => q.id);

// src/game-session.mjs
var clamp2 = (value, low, high) => Math.max(low, Math.min(high, value));
var SESSION_CONFIG = Object.freeze({
  id: "pm-session-config",
  version: "0.37.2",
  startAge: 23,
  agentCount: 700,
  hashActions: true,
  liabilityThreshold: 2.4,
  reckoningFundsDrain: 0.12,
  reckoningStandingDrain: 0.12
});
var PHASES = Object.freeze({
  TITLE: "TITLE",
  STORY_CHOICE: "STORY_CHOICE",
  PRIVATE_READ: "PRIVATE_READ",
  PUBLIC_MOVE: "PUBLIC_MOVE",
  REACTION: "REACTION",
  CHAIN_RETURN: "CHAIN_RETURN",
  DEVELOPMENT_FOCUS: "DEVELOPMENT_FOCUS",
  DEVELOPMENT_RESULT: "DEVELOPMENT_RESULT",
  WILDERNESS_CHOICE: "WILDERNESS_CHOICE",
  WILDERNESS_RESULT: "WILDERNESS_RESULT",
  ELECTION_RESULT: "ELECTION_RESULT",
  CAREER_SUMMARY: "CAREER_SUMMARY",
  MINI_MIRROR: "MINI_MIRROR"
});
var ACTIONS = Object.freeze({
  START_GAME: "START_GAME",
  SUBMIT_PRIVATE_READ: "SUBMIT_PRIVATE_READ",
  SELECT_PUBLIC_MOVE: "SELECT_PUBLIC_MOVE",
  SELECT_WILDERNESS_ROUTE: "SELECT_WILDERNESS_ROUTE",
  SELECT_DEVELOPMENT_FOCUS: "SELECT_DEVELOPMENT_FOCUS",
  CONTINUE_REACTION: "CONTINUE_REACTION",
  CONTINUE_CHAIN: "CONTINUE_CHAIN",
  CONTINUE_ELECTION: "CONTINUE_ELECTION",
  CONTINUE_DEVELOPMENT_RESULT: "CONTINUE_DEVELOPMENT_RESULT",
  CONTINUE_WILDERNESS: "CONTINUE_WILDERNESS",
  VIEW_MIRROR: "VIEW_MIRROR"
});
var GameSessionError = class extends Error {
  constructor(message2, code = "INVALID_ACTION") {
    super(message2);
    this.name = "GameSessionError";
    this.code = code;
  }
};
var DEFAULT_PLAYER = Object.freeze({
  name: "A. Reyes",
  bloc: "CIV",
  region: "Harrow Vale",
  route: "CIVIC"
});
function clonePlain(value) {
  if (value === void 0) return void 0;
  return structuredClone(value);
}
function finite(value, label) {
  if (!Number.isFinite(value)) throw new GameSessionError(`${label} must be finite`, "INVALID_CONFIG");
  return value;
}
function resolveCanonicalSeed(seed, testMode) {
  const mode = resolveTestMode(testMode);
  const forced = mode ? PLAYTEST_SEEDS[mode].seed : null;
  return String(forced || seed || "POL-M7GX4").trim().toUpperCase() || "POL-M7GX4";
}
function buildWorld(seed, player, agentCount = SESSION_CONFIG.agentCount, config = SESSION_CONFIG) {
  const route = ROUTES.find((candidate) => candidate.id === player.route);
  if (!route) throw new GameSessionError(`unknown background route: ${player.route}`, "INVALID_CONFIG");
  const root = seedFromString(seed);
  return {
    root,
    route,
    n: finite(agentCount, "agentCount"),
    worldSeed: deriveSeed(root, "world"),
    eventSeed: deriveSeed(root, "events"),
    actorSeed: deriveSeed(root, "actors"),
    playerBloc: player.bloc,
    rivalBloc: OPP(player.bloc),
    startMu: route.start.mu,
    startTau: route.start.tau,
    startAge: config.startAge
  };
}
function createGameSession({
  seed = "POL-M7GX4",
  player = DEFAULT_PLAYER,
  agentCount = SESSION_CONFIG.agentCount,
  testMode = null,
  config = {}
} = {}) {
  const mergedConfig = Object.freeze({ ...SESSION_CONFIG, ...config, startAge: 23 });
  const canonicalPlayer = { ...DEFAULT_PLAYER, ...player };
  if (!["CIV", "REN"].includes(canonicalPlayer.bloc))
    throw new GameSessionError(`unknown political bloc: ${canonicalPlayer.bloc}`, "INVALID_CONFIG");
  if (!Number.isInteger(agentCount) || agentCount <= 0)
    throw new GameSessionError("agentCount must be a positive integer", "INVALID_CONFIG");
  return {
    sessionVersion: "0.37.2",
    config: mergedConfig,
    requestedSeed: String(seed || ""),
    seed: resolveCanonicalSeed(seed, testMode),
    testMode: resolveTestMode(testMode),
    player: canonicalPlayer,
    agentCount,
    phase: PHASES.TITLE,
    complete: false,
    started: false,
    script: [],
    beatIndex: 0,
    currentBeatId: null,
    world: null,
    agents: null,
    worldRng: null,
    actorRng: null,
    eventRng: null,
    rivalArc: [],
    rivalProfile: null,
    rivalPush: null,
    tape: makeTape(),
    st: null,
    pending: {},
    resumeAfterDevelopment: null,
    beatTrace: [],
    eventTrace: [],
    elections: [],
    actionIndex: 0,
    lastAction: null,
    actionTranscript: [],
    mirror: null
  };
}
function currentBeat(session) {
  return session.script[session.beatIndex] || null;
}
function requireStarted(session) {
  if (!session.started || !session.st) throw new GameSessionError("game has not started", "NOT_STARTED");
}
function initWorld(session) {
  const world = buildWorld(session.seed, session.player, session.agentCount, session.config);
  const { agents, wr, tilt } = buildInitialWorld(world);
  const actorRng = makeRng(world.actorSeed);
  const tipTrue = wr.float() < 0.42;
  world.errorFound = wr.float() < 0.45;
  world.leakTraced = wr.float() < 0.38;
  const rival = rollRival(wr);
  const start = world.route.start;
  const abilities = makeAbilities(makeRng(deriveSeed(world.worldSeed, "abilities")), world.route.id);
  session.world = world;
  session.agents = agents;
  session.worldRng = wr;
  session.actorRng = actorRng;
  session.eventRng = makeRng(world.eventSeed);
  session.rivalArc = rival.arc;
  session.rivalProfile = rival.profile;
  session.rivalPush = rival.push;
  session.tape = makeTape();
  session.script = SCRIPT(session.player);
  session.beatIndex = 0;
  session.currentBeatId = null;
  session.st = {
    abilities,
    age: session.config.startAge,
    office: null,
    recognition: 0.5,
    independence: 0.5,
    out: null,
    lastOutRoute: null,
    wildYears: 0,
    capital: start.capital,
    funds: start.funds,
    standing: start.standing,
    world,
    flags: {},
    log: [],
    history: [],
    chains: {},
    execs: [],
    focusLog: [],
    reactions: [],
    liability: 0,
    reckoning: null,
    tipTrue,
    rivalProfile: rival.profile.id,
    tilt
  };
  session.started = true;
}
function traceEntry(session, beat, whenResult) {
  const entry = {
    beatIndex: session.beatIndex,
    beatId: beat.id,
    kind: beat.kind,
    authoredAge: beat.age,
    ageBefore: session.st.age,
    whenResult,
    skipped: !whenResult,
    privateReadPresented: false,
    publicMovePresented: false,
    presentedChoices: [],
    eventsFired: [],
    nextPhase: null
  };
  session.beatTrace.push(entry);
  return entry;
}
function activeTrace(session) {
  for (let i = session.beatTrace.length - 1; i >= 0; i--) {
    if (session.beatTrace[i].beatIndex === session.beatIndex) return session.beatTrace[i];
  }
  return null;
}
function fireEvent(session, event, age, seedActor = null, label = null) {
  const full = { ...event, __age: age, __seedActor: seedActor, __label: label };
  if (seedActor) seedBeliefs(session.agents, event.actorId, seedActor[0], seedActor[1], session.actorRng);
  tapeEvent(session.tape, full);
  const reaction = applyEvent(session.agents, event, session.eventRng, session.player.bloc);
  const record = {
    index: session.eventTrace.length,
    beatId: currentBeat(session)?.id || null,
    age,
    actorId: event.actorId,
    trait: event.trait || "integrity",
    implication: event.implication,
    label
  };
  session.eventTrace.push(record);
  session.st.reactions.push({ ...record, delta: reaction.delta });
  const trace = activeTrace(session);
  if (trace) trace.eventsFired.push(record.index);
  return reaction;
}
function advanceAgeTo(session, age) {
  if (age < session.st.age)
    throw new GameSessionError(`age cannot move backward (${session.st.age} -> ${age})`, "AGE_REGRESSION");
  if (age > session.st.age) {
    const years = age - session.st.age;
    ageElectorate(session.agents, years);
    tapeAge(session.tape, age, years, `age ${session.st.age} to ${age}`, "timeline");
    session.st.age = age;
  }
  while (session.rivalArc.length && session.rivalArc[0].age <= session.st.age) {
    const arc = session.rivalArc.shift();
    for (const actorId of ["RIVAL1", "RIVAL2"]) {
      fireEvent(session, {
        actorId,
        implication: arc.implication,
        strength: 0.9,
        reliability: 0.9,
        diagnosticity: 0.8,
        deniability: 0,
        trait: arc.trait,
        targetSide: "OPPOSING_SIDE",
        sourceAlignment: "NEUTRAL",
        crowd: null,
        mediaReach: 0.95
      }, arc.age, null, `rival ${arc.trait} arc`);
    }
  }
}
function finishBeat(session) {
  const trace = activeTrace(session);
  if (trace) trace.nextPhase = "ADVANCE";
  session.beatIndex += 1;
  session.currentBeatId = null;
  session.pending = {};
  session.resumeAfterDevelopment = null;
  return advanceToNextInteraction(session);
}
function scheduleDevelopment(session, grant, resume) {
  grantPoints(session.st.abilities, grant.n, grant.reason);
  session.pending.developmentGrant = clonePlain(grant);
  session.pending.developmentResult = null;
  session.resumeAfterDevelopment = resume;
  session.phase = PHASES.DEVELOPMENT_FOCUS;
}
function resolveElection(session, beat) {
  if (beat.tier === 2 && !session.st.flags.RECKONED) {
    session.st.flags.RECKONED = true;
    const reckoning = liabilityReckoning(
      session.st.liability || 0,
      session.config.liabilityThreshold
    );
    if (reckoning) {
      session.st.reckoning = reckoning.magnitude;
      session.st.funds = Math.max(0, Math.round(session.st.funds * (1 - session.config.reckoningFundsDrain * reckoning.magnitude)));
      session.st.standing = Math.max(0, Math.round(session.st.standing * (1 - session.config.reckoningStandingDrain * reckoning.magnitude)));
      fireEvent(session, { actorId: "PLAYER", ...reckoning.signal }, beat.age, null, "The pattern");
    }
  }
  const electionWorld = {
    rivalPush: session.rivalPush,
    rivalProfileId: session.rivalProfile.id,
    playerBloc: session.player.bloc,
    rivalBloc: OPP(session.player.bloc),
    seedFor: (label) => deriveSeed(session.world.root, label)
  };
  const { spec, res, won } = holdElection(
    session.agents,
    session.st,
    beat,
    electionWorld,
    makeRng
  );
  tapeElection(session.tape, spec);
  session.st.office = won ? beat.office : null;
  const result = {
    age: beat.age,
    office: beat.office,
    won,
    share: res.shares.PLAYER,
    turnout: res.turnout,
    approval: approvalOf(session.agents, "PLAYER"),
    winner: res.winner,
    tally: clonePlain(res.tally),
    shares: clonePlain(res.shares),
    spec: clonePlain(spec)
  };
  session.elections.push(result);
  session.st.history.push({
    age: beat.age,
    kind: "election",
    office: beat.office,
    won,
    share: result.share,
    turnout: result.turnout,
    approval: result.approval
  });
  session.pending.election = result;
  if (beat.tier === 1) {
    const campaign = won ? CAMPAIGN_XP.WON : CAMPAIGN_XP.LOST;
    addExperience(session.st.abilities, campaign.tags, campaign.label);
    scheduleDevelopment(
      session,
      DP_GRANTS.FIRST_CAMPAIGN,
      { type: "PHASE", phase: PHASES.ELECTION_RESULT }
    );
  } else {
    session.phase = PHASES.ELECTION_RESULT;
  }
}
function resolveChain(session, beat) {
  const spec = CHAINS[beat.chain];
  const read = session.st.log.find((entry) => entry.kind === "read" && entry.eventId === spec.seedId);
  const move = session.st.log.find((entry) => entry.kind === "move" && entry.eventId === spec.seedId);
  if (!read && !move) return false;
  const verdict = chainVerdict(spec.outcome, read ? read.credence : null, move);
  session.st.chains[beat.chain] = {
    ...verdict,
    seedId: spec.seedId,
    credence: read?.credence ?? null,
    choiceId: move?.choiceId ?? null
  };
  const text2 = CHAIN_TEXT[beat.chain](verdict);
  let reaction = null;
  if (verdict.signal) {
    reaction = fireEvent(
      session,
      { actorId: "PLAYER", ...verdict.signal },
      beat.age,
      null,
      `the ${beat.chain.toLowerCase()} file resurfacing`
    );
  }
  session.pending.chain = {
    chain: beat.chain,
    ...text2,
    verdictData: verdict,
    recall: chainRecall(spec, read ? read.credence : null, move),
    said: read ? LADDER[0][read.credence] : null,
    did: move?.label ?? null,
    seedTitle: read?.title || move?.title || null,
    reaction
  };
  session.phase = PHASES.CHAIN_RETURN;
  return true;
}
function resolveWilderness(session, beat) {
  const route = session.st.out;
  if (!route) return false;
  session.st.lastOutRoute = route.route;
  session.st.wildYears += 2;
  if (route.fade > 0) {
    ageElectorate(session.agents, route.fade);
    tapeAge(session.tape, beat.age, route.fade, `${route.route} wilderness fade`);
  }
  if (route.local) session.st.capital += 2;
  if (route.route === "STAFF") session.st.standing += 2;
  if (route.route === "PROFESSIONAL") session.st.funds += 3;
  if (route.route === "MEDIA") {
    session.st.recognition = clamp2(session.st.recognition + 0.08, 0, 1);
    session.st.flags.IMAGE_HARDENED = true;
  }
  const payoff = WILDERNESS_PAYOFF[route.route];
  const reaction = payoff ? fireEvent(session, {
    actorId: "PLAYER",
    ...payoff,
    deniability: 0,
    targetSide: "PLAYER_SIDE",
    sourceAlignment: "NEUTRAL",
    crowd: null
  }, beat.age, null, "your four years out") : null;
  addExperience(
    session.st.abilities,
    route.route === "MEDIA" ? ["COMM"] : route.route === "STAFF" ? ["NEG"] : route.route === "LOCAL" ? ["ORG"] : ["STRAT"],
    "Four years out of office"
  );
  session.st.history.push({ age: beat.age, kind: "wilderness", route: route.route });
  session.pending.wilderness = {
    route: route.route,
    text: WILDERNESS_TEXT[route.route],
    note: route.note,
    fade: route.fade,
    reaction
  };
  scheduleDevelopment(
    session,
    DP_GRANTS.WILDERNESS,
    { type: "PHASE", phase: PHASES.WILDERNESS_RESULT }
  );
  return true;
}
function setPresentedPhase(session, trace, phase) {
  session.phase = phase;
  trace.nextPhase = phase;
  if (phase === PHASES.PRIVATE_READ) trace.privateReadPresented = true;
  if ([PHASES.PUBLIC_MOVE, PHASES.STORY_CHOICE, PHASES.WILDERNESS_CHOICE].includes(phase)) {
    trace.publicMovePresented = true;
    trace.presentedChoices = (currentBeat(session)?.choices || []).map((choice) => ({
      id: choice.id,
      ...choiceStatus(session, choice)
    }));
  }
  return getCurrentInteraction(session);
}
function advanceToNextInteraction(session) {
  requireStarted(session);
  while (session.beatIndex < session.script.length) {
    const beat = currentBeat(session);
    session.currentBeatId = beat.id;
    const whenResult = beat.when ? Boolean(beat.when(session.st)) : true;
    const trace = traceEntry(session, beat, whenResult);
    if (!whenResult) {
      trace.nextPhase = "SKIPPED";
      session.beatIndex += 1;
      session.currentBeatId = null;
      continue;
    }
    advanceAgeTo(session, beat.age);
    if (beat.kind === "election") {
      resolveElection(session, beat);
      trace.nextPhase = session.phase;
      return getCurrentInteraction(session);
    }
    if (beat.kind === "milestone") {
      if (beat.grant && !session.st.flags[`MS_${beat.id}`]) {
        session.st.flags[`MS_${beat.id}`] = true;
        session.st.history.push({ age: beat.age, kind: "milestone", id: beat.id });
        scheduleDevelopment(session, DP_GRANTS[beat.grant], { type: "ADVANCE" });
        trace.nextPhase = session.phase;
        return getCurrentInteraction(session);
      }
      trace.nextPhase = "AUTO_ADVANCE";
      session.beatIndex += 1;
      session.currentBeatId = null;
      continue;
    }
    if (beat.kind === "wilderness") {
      if (resolveWilderness(session, beat)) {
        trace.nextPhase = session.phase;
        return getCurrentInteraction(session);
      }
      trace.nextPhase = "AUTO_ADVANCE";
      session.beatIndex += 1;
      session.currentBeatId = null;
      continue;
    }
    if (beat.kind === "chain") {
      if (resolveChain(session, beat)) {
        trace.nextPhase = session.phase;
        return getCurrentInteraction(session);
      }
      trace.nextPhase = "AUTO_ADVANCE";
      session.beatIndex += 1;
      session.currentBeatId = null;
      continue;
    }
    if (beat.kind === "consequence") {
      const resolution = beat.resolve(session.st);
      const reaction = fireEvent(
        session,
        { actorId: "PLAYER", ...resolution.event },
        beat.age,
        null,
        beat.title
      );
      session.st.history.push({ age: beat.age, kind: "consequence", title: beat.title });
      session.pending.reaction = { text: resolution.text, reaction, title: beat.title };
      return setPresentedPhase(session, trace, PHASES.REACTION);
    }
    if (beat.kind === "fallout") {
      const hard = Boolean(session.st.flags.TIP_ATTACK);
      const implication = session.st.tipTrue ? hard ? 0.35 : 0.18 : hard ? -0.8 : -0.45;
      session.st.flags.TIP_BACKFIRED = !session.st.tipTrue;
      const reaction = fireEvent(session, {
        actorId: "PLAYER",
        implication,
        strength: 0.8,
        reliability: 0.9,
        diagnosticity: 0.7,
        deniability: 0,
        trait: "integrity",
        targetSide: "PLAYER_SIDE",
        sourceAlignment: implication < 0 ? "OPPOSED" : "ALIGNED",
        crowd: null,
        mediaReach: 0.9,
        salience: 0.4
      }, beat.age, null, "the folder you used");
      session.pending.reaction = {
        title: beat.title || "The folder returns",
        text: session.st.tipTrue ? "The foundation story holds up. Two reporters confirm the transfers independently, and the material you used turns out to have been true." : "The foundation story collapses eight days before the vote. The transfers were routine and documented, and the correction runs beside a photograph of you making the claim.",
        reaction
      };
      return setPresentedPhase(session, trace, PHASES.REACTION);
    }
    if (beat.playerAllegation) {
      session.pending.allegationReaction = fireEvent(
        session,
        { actorId: "PLAYER", ...beat.playerAllegation },
        beat.age,
        null,
        beat.title
      );
    }
    if (beat.kind === "judgment") return setPresentedPhase(session, trace, PHASES.PRIVATE_READ);
    const phase = beat.id === "WILDERNESS" ? PHASES.WILDERNESS_CHOICE : PHASES.STORY_CHOICE;
    return setPresentedPhase(session, trace, phase);
  }
  session.phase = PHASES.CAREER_SUMMARY;
  session.currentBeatId = null;
  session.pending = {};
  return getCurrentInteraction(session);
}
function validateBeatAction(session, action) {
  const beat = currentBeat(session);
  if (!beat) throw new GameSessionError("there is no active beat", "INVALID_BEAT");
  if (!action.beatId) throw new GameSessionError(`${action.type} requires beatId`, "INVALID_BEAT");
  if (action.beatId !== beat.id) {
    throw new GameSessionError(
      `${action.type} targets beat ${action.beatId}, but current beat is ${beat.id}`,
      "INVALID_BEAT"
    );
  }
  return beat;
}
function choiceStatus(session, choice) {
  if (!meets(session.st.abilities, choice.requires)) {
    return { ok: false, reason: unmetReason(session.st.abilities, choice.requires), kind: "ABILITY" };
  }
  const resource = choiceAvailability(choice, session.st);
  return resource.ok ? { ok: true } : { ...resource, kind: "RESOURCE" };
}
function applyPublicChoice(session, beat, choice) {
  const status = choiceStatus(session, choice);
  if (!status.ok) throw new GameSessionError(`choice ${choice.id} is locked: ${status.reason}`, "LOCKED_CHOICE");
  session.st.log.push({
    kind: "move",
    eventId: beat.id,
    title: beat.title,
    label: choice.label,
    choiceId: choice.id,
    features: clonePlain(choice.features),
    responsibility: Boolean(beat.responsibility),
    institutional: Boolean(choice.institutional || beat.institutional),
    temptation: Boolean(beat.temptation)
  });
  session.st.liability += choiceLiability(choice.features);
  payCost(choice, session.st);
  if (choice.out) {
    session.st.out = clonePlain(choice.out);
    session.st.recognition = clamp2(session.st.recognition + choice.out.recognition, 0, 1);
    session.st.independence = clamp2(session.st.independence + choice.out.independence, 0, 1);
  }
  if (choice.career) {
    session.st.recognition = clamp2(session.st.recognition + (choice.career.recognition || 0), 0, 1);
    session.st.independence = clamp2(session.st.independence + (choice.career.independence || 0), 0, 1);
  }
  for (const [key, value] of Object.entries(choice.effect || {}))
    session.st[key] = Math.max(0, (session.st[key] || 0) + value);
  if (choice.flag) session.st.flags[choice.flag] = true;
  if (choice.flag === "COMEBACK_RUN" || choice.flag === "COMEBACK_DECLINE") session.st.out = null;
  if (choice.flag === "COMEBACK_RUN") {
    session.st.office = "Ward Council";
    session.st.flags.CAME_BACK = true;
  }
  if (beat.flag) session.st.flags[beat.flag] = true;
  let execution = null;
  if (choice.check) {
    execution = check2(
      session.st.abilities,
      choice.check.ability,
      choice.check.dc,
      makeRng(deriveSeed(session.world.worldSeed, `exec:${beat.id}:${choice.id}`)),
      { pressure: beat.pressure || 0 }
    );
    session.st.execs.push({
      beat: beat.id,
      choiceId: choice.id,
      ability: choice.check.ability,
      value: session.st.abilities.value[choice.check.ability],
      grade: execution.grade
    });
  }
  addExperience(session.st.abilities, choice.xp || XP_TAGS[beat.id] || [], beat.title);
  let reaction = null;
  if (choice.signal) {
    reaction = fireEvent(session, {
      actorId: "PLAYER",
      reliability: 0.9,
      diagnosticity: 0.65,
      deniability: 0,
      targetSide: "PLAYER_SIDE",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: session.st.office ? 0.8 : 0.5,
      ...choice.signal,
      stakes: choice.stakes
    }, beat.age, null, beat.title);
  }
  const executionScale = execution ? execution.scale : 1;
  for (const signal of actionSignals(choice.features, {
    scrutiny: session.st.office ? 0.85 : 0.45,
    salience: beat.salience ?? (session.st.office ? 0.45 : 0.3),
    stakes: choice.stakes
  })) {
    reaction = fireEvent(session, {
      actorId: "PLAYER",
      ...signal,
      implication: clamp2(signal.implication * executionScale, -1, 1)
    }, beat.age, null, beat.title);
  }
  if (execution && execution.grade !== "solid") {
    const implication = { excellent: 0.42, poor: -0.3, botched: -0.55 }[execution.grade];
    reaction = fireEvent(session, {
      actorId: "PLAYER",
      implication,
      strength: 0.6,
      reliability: 0.9,
      diagnosticity: 0.6,
      deniability: 0,
      trait: "competence",
      targetSide: "PLAYER_SIDE",
      sourceAlignment: "NEUTRAL",
      crowd: null,
      mediaReach: session.st.office ? 0.7 : 0.45
    }, beat.age, null, `${beat.title} (execution)`);
  }
  if ((choice.features?.transparency || 0) + (choice.features?.exploitation || 0) > 0.25) {
    session.st.recognition = clamp2(session.st.recognition + recognitionGain(session.st.abilities, 0.012), 0, 1);
  }
  if (choice.hitsRival) {
    fireEvent(session, {
      actorId: beat.age >= 33 ? "RIVAL2" : "RIVAL1",
      implication: -choice.hitsRival,
      strength: 0.7,
      reliability: 0.65,
      diagnosticity: 0.7,
      deniability: 0.3,
      trait: "integrity",
      targetSide: "OPPOSING_SIDE",
      sourceAlignment: "ALIGNED",
      crowd: null,
      mediaReach: 0.85
    }, beat.age, null, beat.title);
  }
  session.st.history.push({
    age: beat.age,
    kind: "choice",
    id: beat.id,
    title: beat.title,
    choiceId: choice.id,
    label: choice.label
  });
  const strategyNote = choice.strategyRead ? session.st.tipTrue ? "Your analyst works through the night. \u201CThe paperwork stands up. Two of these transfers are real and I can show you why.\u201D" : "Your analyst works through the night. \u201CThere is nothing underneath this. Somebody assembled it to look like something.\u201D" : null;
  session.pending.reaction = reaction || strategyNote || execution ? { title: beat.title, reaction, execution: clonePlain(execution), strategyNote } : null;
  if (beat.id === "PARTY_OFFER" && !session.st.flags.MIDCAREER_DP) {
    session.st.flags.MIDCAREER_DP = true;
    scheduleDevelopment(
      session,
      DP_GRANTS.MIDCAREER,
      session.pending.reaction ? { type: "PHASE", phase: PHASES.REACTION } : { type: "ADVANCE" }
    );
    return;
  }
  if (session.pending.reaction) session.phase = PHASES.REACTION;
  else finishBeat(session);
}
function submitRead(session, action) {
  const beat = validateBeatAction(session, action);
  if (!Number.isInteger(action.credence) || action.credence < 0 || action.credence > 3)
    throw new GameSessionError("credence must be an integer from 0 to 3", "INVALID_PAYLOAD");
  session.st.log.push({
    kind: "read",
    eventId: beat.id,
    title: beat.title,
    pairId: beat.pairId,
    factor: beat.factor,
    level: beat.level,
    credence: action.credence,
    chainSeed: beat.chainSeed,
    ...clonePlain(beat.latents)
  });
  fireEvent(
    session,
    { actorId: `OTHER_${beat.id}`, ...beat.latents },
    beat.age,
    [0.5, 1.1],
    beat.title
  );
  session.phase = PHASES.PUBLIC_MOVE;
  const trace = activeTrace(session);
  if (trace) {
    trace.publicMovePresented = true;
    trace.presentedChoices = (beat.choices || []).map((choice) => ({
      id: choice.id,
      ...choiceStatus(session, choice)
    }));
    trace.nextPhase = PHASES.PUBLIC_MOVE;
  }
}
function chooseMove(session, action, expectedPhase) {
  const beat = validateBeatAction(session, action);
  if (session.phase !== expectedPhase)
    throw new GameSessionError(`${action.type} is invalid during ${session.phase}`, "WRONG_PHASE");
  const choice = beat.choices?.find((candidate) => candidate.id === action.choiceId);
  if (!choice) throw new GameSessionError(`unknown choice ${action.choiceId} for ${beat.id}`, "INVALID_CHOICE");
  applyPublicChoice(session, beat, choice);
}
function selectDevelopment(session, action) {
  validateBeatAction(session, action);
  if (!ABILITY_IDS.includes(action.primary) || !ABILITY_IDS.includes(action.secondary))
    throw new GameSessionError("development focus requires two valid ability ids", "INVALID_PAYLOAD");
  if (action.primary === action.secondary)
    throw new GameSessionError("primary and secondary development focuses must differ", "INVALID_PAYLOAD");
  const grant = session.pending.developmentGrant;
  const before = { ...session.st.abilities.value };
  const result = applyFocus(session.st.abilities, action.primary, action.secondary, grant.n);
  session.st.abilities.dp = 0;
  const record = {
    reason: grant.reason,
    budget: grant.n,
    primary: action.primary,
    secondary: action.secondary,
    before,
    after: { ...session.st.abilities.value },
    result: clonePlain(result),
    gained: (result.primary?.gained || 0) + (result.secondary?.gained || 0)
  };
  session.st.focusLog.push(record);
  session.pending.developmentResult = record;
  session.phase = PHASES.DEVELOPMENT_RESULT;
}
function resumeAfterDevelopment(session) {
  const resume = session.resumeAfterDevelopment;
  session.resumeAfterDevelopment = null;
  session.pending.developmentGrant = null;
  session.pending.developmentResult = null;
  if (resume?.type === "PHASE") {
    session.phase = resume.phase;
    return;
  }
  finishBeat(session);
}
function assertPhase(session, expected, action) {
  if (session.phase !== expected)
    throw new GameSessionError(
      `${action.type} is invalid during ${session.phase}; expected ${expected}`,
      "WRONG_PHASE"
    );
}
function canonicalAction(action) {
  const copy = {};
  for (const key of Object.keys(action).sort()) copy[key] = clonePlain(action[key]);
  return copy;
}
function dispatchGameAction(session, action) {
  if (!action || typeof action.type !== "string")
    throw new GameSessionError("action.type is required", "INVALID_ACTION");
  if (session.complete) throw new GameSessionError("session is already complete", "POST_COMPLETION");
  const phaseBefore = session.phase;
  switch (action.type) {
    case ACTIONS.START_GAME:
      if (session.started) throw new GameSessionError("START_GAME may only be submitted once", "DUPLICATE_ACTION");
      assertPhase(session, PHASES.TITLE, action);
      initWorld(session);
      advanceToNextInteraction(session);
      break;
    case ACTIONS.SUBMIT_PRIVATE_READ:
      assertPhase(session, PHASES.PRIVATE_READ, action);
      submitRead(session, action);
      break;
    case ACTIONS.SELECT_PUBLIC_MOVE:
      if (![PHASES.PUBLIC_MOVE, PHASES.STORY_CHOICE].includes(session.phase))
        throw new GameSessionError(`${action.type} is invalid during ${session.phase}`, "WRONG_PHASE");
      chooseMove(session, action, session.phase);
      break;
    case ACTIONS.SELECT_WILDERNESS_ROUTE:
      chooseMove(session, action, PHASES.WILDERNESS_CHOICE);
      break;
    case ACTIONS.SELECT_DEVELOPMENT_FOCUS:
      assertPhase(session, PHASES.DEVELOPMENT_FOCUS, action);
      selectDevelopment(session, action);
      break;
    case ACTIONS.CONTINUE_DEVELOPMENT_RESULT:
      assertPhase(session, PHASES.DEVELOPMENT_RESULT, action);
      validateBeatAction(session, action);
      resumeAfterDevelopment(session);
      break;
    case ACTIONS.CONTINUE_REACTION:
      assertPhase(session, PHASES.REACTION, action);
      validateBeatAction(session, action);
      finishBeat(session);
      break;
    case ACTIONS.CONTINUE_CHAIN:
      assertPhase(session, PHASES.CHAIN_RETURN, action);
      validateBeatAction(session, action);
      finishBeat(session);
      break;
    case ACTIONS.CONTINUE_ELECTION:
      assertPhase(session, PHASES.ELECTION_RESULT, action);
      validateBeatAction(session, action);
      finishBeat(session);
      break;
    case ACTIONS.CONTINUE_WILDERNESS:
      assertPhase(session, PHASES.WILDERNESS_RESULT, action);
      validateBeatAction(session, action);
      finishBeat(session);
      break;
    case ACTIONS.VIEW_MIRROR:
      assertPhase(session, PHASES.CAREER_SUMMARY, action);
      session.mirror = buildMirror(session);
      session.phase = PHASES.MINI_MIRROR;
      session.complete = true;
      break;
    default:
      throw new GameSessionError(`unknown action type: ${action.type}`, "UNKNOWN_ACTION");
  }
  session.actionIndex += 1;
  session.lastAction = canonicalAction(action);
  const hash = session.config.hashActions ? hashCanonicalState(session) : null;
  const record = {
    index: session.actionIndex,
    action: session.lastAction,
    phaseBefore,
    phaseAfter: session.phase,
    beatId: session.currentBeatId,
    hash
  };
  session.actionTranscript.push(record);
  return record;
}
function beatView(beat) {
  if (!beat) return null;
  return {
    id: beat.id,
    age: beat.age,
    kind: beat.kind,
    chapter: beat.chapter || null,
    title: beat.title || null,
    text: beat.text || null,
    prompt: beat.prompt || null,
    readPrompt: beat.readPrompt || null,
    readFormat: beat.readFormat ?? 0,
    factor: beat.factor || null,
    pairId: beat.pairId || null,
    level: beat.level || null,
    latents: clonePlain(beat.latents || null),
    chain: beat.chain || null,
    tier: beat.tier || null,
    office: beat.office || null
  };
}
function choiceView(session, choice) {
  return {
    id: choice.id,
    label: choice.label,
    requires: clonePlain(choice.requires || null),
    cost: clonePlain(choice.cost || null),
    availability: choiceStatus(session, choice)
  };
}
function buildMirror(session) {
  requireStarted(session);
  const analysis = analysePlayer(session.st.log);
  const resolution = mirrorResolution(analysis, session.st.log);
  return {
    analysis,
    resolution,
    cross: crossMirror(analysis, session.st.log),
    checklist: checklist(analysis),
    inputs: {
      reads: clonePlain(session.st.log.filter((entry) => entry.kind === "read")),
      moves: clonePlain(session.st.log.filter((entry) => entry.kind === "move"))
    }
  };
}
function getCurrentInteraction(session) {
  const beat = currentBeat(session);
  const base = {
    phase: session.phase,
    complete: session.complete,
    seed: session.seed,
    testMode: session.testMode,
    beat: beatView(beat),
    publicState: session.st ? {
      age: session.st.age,
      office: session.st.office,
      capital: session.st.capital,
      funds: session.st.funds,
      standing: session.st.standing,
      recognition: session.st.recognition,
      independence: session.st.independence,
      liability: session.st.liability,
      abilities: clonePlain(session.st.abilities),
      belief: meanBelief(session.agents, "PLAYER"),
      approval: approvalOf(session.agents, "PLAYER"),
      precision: meanPrecision(session.agents, "PLAYER")
    } : null
  };
  if (beat?.choices && [
    PHASES.STORY_CHOICE,
    PHASES.PUBLIC_MOVE,
    PHASES.WILDERNESS_CHOICE
  ].includes(session.phase)) {
    base.choices = beat.choices.map((choice) => choiceView(session, choice));
  }
  if (session.phase === PHASES.PRIVATE_READ) base.ladder = clonePlain(LADDER[beat.readFormat ?? 0]);
  if (session.phase === PHASES.REACTION) base.reaction = clonePlain(session.pending.reaction);
  if (session.phase === PHASES.CHAIN_RETURN) base.chain = clonePlain(session.pending.chain);
  if (session.phase === PHASES.ELECTION_RESULT) base.election = clonePlain(session.pending.election);
  if (session.phase === PHASES.WILDERNESS_RESULT) base.wilderness = clonePlain(session.pending.wilderness);
  if (session.phase === PHASES.DEVELOPMENT_FOCUS) {
    base.development = {
      grant: clonePlain(session.pending.developmentGrant),
      focuses: LIFE_FOCUS.map((focus) => clonePlain(focus))
    };
  }
  if (session.phase === PHASES.DEVELOPMENT_RESULT)
    base.development = { result: clonePlain(session.pending.developmentResult) };
  if (session.phase === PHASES.CAREER_SUMMARY) {
    base.summary = {
      elections: clonePlain(session.elections),
      chains: clonePlain(session.st.chains),
      moves: session.st.log.filter((entry) => entry.kind === "move").length,
      reads: session.st.log.filter((entry) => entry.kind === "read").length
    };
  }
  if (session.phase === PHASES.MINI_MIRROR) base.mirror = clonePlain(session.mirror);
  return base;
}
function normalized(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new GameSessionError("canonical state contains a non-finite number", "INVALID_STATE");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalized);
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== void 0 && typeof value[key] !== "function") out[key] = normalized(value[key]);
    }
    return out;
  }
  return String(value);
}
function stableStringify(value) {
  return JSON.stringify(normalized(value));
}
function hashText(text2) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text2.length; i++) {
    const code = text2.charCodeAt(i);
    hash ^= BigInt(code & 255);
    hash = BigInt.asUintN(64, hash * prime);
    hash ^= BigInt(code >>> 8);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}
function voterStateDigest(session) {
  if (!session.agents) return null;
  const voters = session.agents.map((agent) => ({
    id: agent.id,
    lean: agent.lean,
    side: agent.side,
    ideology: agent.ideology,
    interest: agent.interest,
    mediaTrust: agent.mediaTrust,
    instTrust: agent.instTrust,
    turnoutBase: agent.turnoutBase,
    crowdSens: agent.crowdSens,
    denialSens: agent.denialSens,
    wInt: agent.wInt,
    wComp: agent.wComp,
    family: agent.family,
    gateBias: agent.gateBias,
    motivBias: agent.motivBias,
    srcBias: agent.srcBias,
    owner: agent.owner,
    young: agent.young,
    publicSector: agent.publicSector,
    business: agent.business,
    beliefs: agent.beliefs
  }));
  return hashText(stableStringify(voters));
}
function serializeCanonicalState(session) {
  return normalized({
    sessionVersion: session.sessionVersion,
    config: session.config,
    seed: session.seed,
    testMode: session.testMode,
    player: session.player,
    agentCount: session.agentCount,
    phase: session.phase,
    complete: session.complete,
    started: session.started,
    beatIndex: session.beatIndex,
    currentBeatId: session.currentBeatId,
    actionIndex: session.actionIndex,
    lastAction: session.lastAction,
    world: session.world ? {
      root: session.world.root,
      n: session.world.n,
      worldSeed: session.world.worldSeed,
      eventSeed: session.world.eventSeed,
      actorSeed: session.world.actorSeed,
      playerBloc: session.world.playerBloc,
      rivalBloc: session.world.rivalBloc,
      startMu: session.world.startMu,
      startTau: session.world.startTau,
      startAge: session.world.startAge,
      errorFound: session.world.errorFound,
      leakTraced: session.world.leakTraced
    } : null,
    state: session.st,
    rivalArc: session.rivalArc,
    rivalProfile: session.rivalProfile,
    rivalPush: session.rivalPush,
    pending: session.pending,
    resumeAfterDevelopment: session.resumeAfterDevelopment,
    beatTrace: session.beatTrace,
    eventTrace: session.eventTrace,
    elections: session.elections,
    rng: session.started ? {
      world: session.worldRng.state(),
      actor: session.actorRng.state(),
      events: session.eventRng.state()
    } : null,
    tape: session.tape,
    mirror: session.mirror,
    voterStateDigest: voterStateDigest(session)
  });
}
function hashCanonicalState(session) {
  return hashText(stableStringify(serializeCanonicalState(session)));
}

// pilot/actor-context.mjs
var ACTOR_CONTEXT_SCHEMA = "pm-actor-context/1";
var PUBLIC_JUDGMENT_EVENTS = Object.freeze({
  OPP_CONTRACT: Object.freeze({ pairId: "P1", factor: "PARTISAN", level: "OPPOSING_SIDE", targetSide: "OPPOSING_SIDE", coding: Object.freeze({ demand: 1, refer: 0.5, quiet: 0 }) }),
  ALLY_CONTRACT: Object.freeze({ pairId: "P1", factor: "PARTISAN", level: "PLAYER_SIDE", targetSide: "PLAYER_SIDE", coding: Object.freeze({ demand: 1, refer: 0.5, shield: 0 }) }),
  CROWD_LOUD: Object.freeze({ pairId: "C1", factor: "CROWD", level: "CROWD_HIGH", targetSide: "NON_PARTISAN", coding: Object.freeze({ ride: 1, process: 0.5, silent: 0 }) }),
  CROWD_QUIET: Object.freeze({ pairId: "C1", factor: "CROWD", level: "CROWD_LOW", targetSide: "NON_PARTISAN", coding: Object.freeze({ push: 1, process: 0.5, silent: 0 }) }),
  RECORDING_DENIABLE: Object.freeze({ pairId: "D1", factor: "DENIABILITY", level: "DEN_HIGH", targetSide: "NON_PARTISAN", coding: Object.freeze({ treat: 1, forensic: 0.5, dismiss: 0 }) }),
  RECORDING_CLEAN: Object.freeze({ pairId: "D1", factor: "DENIABILITY", level: "DEN_LOW", targetSide: "NON_PARTISAN", coding: Object.freeze({ treat: 1, forensic: 0.5, dismiss: 0 }) }),
  TIP_HOUSING: Object.freeze({ pairId: null, factor: "EVIDENCE", level: null, targetSide: "NON_PARTISAN", coding: Object.freeze({ push: 1, refer: 0.5, bin: 0 }) }),
  GRANT_QUESTION: Object.freeze({ pairId: null, factor: "EVIDENCE", level: null, targetSide: "NON_PARTISAN", coding: Object.freeze({ demand: 1, inquiry: 0.5, shrug: 0 }) }),
  SMEAR_RIVAL: Object.freeze({ pairId: null, factor: "EVIDENCE", level: null, targetSide: "OPPOSING_SIDE", coding: Object.freeze({ run: 1, verify: 0.5, pass: 0 }) })
});
var round6 = (x) => Math.round(x * 1e6) / 1e6;
function beatIndex(player) {
  const index = /* @__PURE__ */ new Map();
  for (const beat of SCRIPT(player)) if (beat && beat.id) index.set(beat.id, beat);
  return index;
}
function extractPublicDecisionContext(spec, transcript, { returnSession = false } = {}) {
  if (!spec || !Array.isArray(transcript)) throw new Error("Game spec and canonical transcript are required");
  const beats = beatIndex(spec.player);
  const session = createGameSession(spec);
  const publicDecisions = [];
  const judgmentDecisions = [];
  let actionIndex = 0;
  for (const entry of transcript) {
    const action = entry.action || entry;
    actionIndex += 1;
    if (action.type === ACTIONS.SELECT_PUBLIC_MOVE || action.type === ACTIONS.SELECT_WILDERNESS_ROUTE) {
      const interaction = getCurrentInteraction(session);
      const choices = (interaction.choices || []).map((c) => ({
        id: c.id,
        available: c.availability?.ok !== false,
        lockKind: c.availability?.ok === false ? c.availability.kind || "LOCKED" : null
      }));
      const record = { actionIndex, eventId: action.beatId, choiceId: action.choiceId, choices };
      publicDecisions.push(record);
      const rule = PUBLIC_JUDGMENT_EVENTS[action.beatId];
      if (rule && action.type === ACTIONS.SELECT_PUBLIC_MOVE) {
        const beat = beats.get(action.beatId);
        if (!beat || !beat.latents) throw new Error(`Frozen script lacks judgment event ${action.beatId}`);
        const ids = choices.map((c) => c.id).sort().join(",");
        const coded = Object.keys(rule.coding).sort().join(",");
        if (ids !== coded) throw new Error(`Option identifiers of ${action.beatId} (${ids}) differ from the M3 coding table (${coded})`);
        if (!(action.choiceId in rule.coding)) throw new Error(`Unknown public choice ${action.choiceId} at ${action.beatId}`);
        const chosen = choices.find((c) => c.id === action.choiceId);
        if (!chosen || !chosen.available) throw new Error(`Chosen option ${action.choiceId} at ${action.beatId} was not selectable`);
        judgmentDecisions.push({
          actionIndex,
          eventId: action.beatId,
          age: beat.age ?? null,
          choiceId: action.choiceId,
          actionCredence: rule.coding[action.choiceId],
          pairId: rule.pairId,
          factor: rule.factor,
          level: rule.level,
          targetSide: rule.targetSide,
          evidenceQuality: round6(beat.latents.strength * beat.latents.reliability),
          deniability: beat.latents.deniability ?? null,
          crowdMagnitude: beat.latents.crowd ? beat.latents.crowd.magnitude : 0,
          choices,
          allOptionsAvailable: choices.every((c) => c.available)
        });
      }
    }
    dispatchGameAction(session, action);
  }
  const context = {
    schema: ACTOR_CONTEXT_SCHEMA,
    actionCount: actionIndex,
    publicDecisions,
    judgmentDecisions,
    codingTable: PUBLIC_JUDGMENT_EVENTS,
    excluded: ["SUBMIT_PRIVATE_READ credences", "reactions", "election tallies", "Mirror", "T0/T1/T2", "questionnaire"]
  };
  const plain2 = JSON.parse(JSON.stringify(context));
  return returnSession ? { context: plain2, session } : plain2;
}
function validateActorContext(context) {
  if (!context || context.schema !== ACTOR_CONTEXT_SCHEMA) throw new Error("Actor context schema mismatch");
  if (!Array.isArray(context.judgmentDecisions) || !Array.isArray(context.publicDecisions)) throw new Error("Actor context is incomplete");
  for (const d of context.judgmentDecisions) {
    const rule = PUBLIC_JUDGMENT_EVENTS[d.eventId];
    if (!rule || rule.coding[d.choiceId] !== d.actionCredence) throw new Error(`Actor context coding mismatch at ${d.eventId}`);
    if (!Number.isFinite(d.evidenceQuality)) throw new Error(`Actor context evidence quality missing at ${d.eventId}`);
    for (const key of Object.keys(d)) {
      if (/credence(?!Action)|read|score|t0|t1|t2|mirror|questionnaire/i.test(key) && key !== "actionCredence")
        throw new Error(`Actor context carries a disallowed field: ${key}`);
    }
  }
  return true;
}

// pilot/prediction.mjs
var MODEL_VERSION = "pm-fixed-transfer/2.0.0";
var MODEL_IDS = Object.freeze(["M0", "M1", "M2", "M3"]);
var MODEL_SPEC = Object.freeze({
  evidenceReference: 0.45,
  interceptPseudoCount: 4,
  evidencePseudoCount: 4,
  pairPseudoCount: 2,
  credenceAnchors: Object.freeze([0.15, 0.4, 0.6, 0.85]),
  output: "probability judgment on 0\u2013100 scale; not probability of a future binary response"
});
var ACTOR_RULE_VERSION = "pm-actor-public-judgment/2.0.0";
var ACTOR_RULE = Object.freeze({
  ruleVersion: ACTOR_RULE_VERSION,
  intercept: 0.5,
  pointsPerUnitIndex: 25,
  actionCredence: Object.freeze({ act: 1, process: 0.5, dismiss: 0 }),
  pairs: Object.freeze({
    partisanSymmetry: Object.freeze({
      pairId: "P1",
      high: "OPP_CONTRACT",
      low: "ALLY_CONTRACT",
      hypothesis: "public readiness to act against an opposing-side official minus own-side official predicts the T1 opposing-minus-own credence contrast (same sign)"
    }),
    crowdSusceptibility: Object.freeze({
      pairId: "C1",
      high: "CROWD_LOUD",
      low: "CROWD_QUIET",
      hypothesis: "public readiness to act under visible public anger minus without it (identical evidence) predicts the T1 crowd-high minus crowd-low contrast (same sign)"
    }),
    deniabilitySusceptibility: Object.freeze({
      pairId: "D1",
      high: "RECORDING_DENIABLE",
      low: "RECORDING_CLEAN",
      hypothesis: "public readiness to act on a deniable recording minus an authenticated one predicts the T1 deniable-minus-authenticated contrast (same sign; usually negative)"
    })
  }),
  evidence: Object.freeze({
    events: Object.freeze(["TIP_HOUSING", "CROWD_QUIET", "GRANT_QUESTION", "RECORDING_CLEAN"]),
    minimumEvents: 3,
    t1DesignRange: 0.5,
    hypothesis: "the least-squares slope of public action credence on frozen evidence quality (non-partisan target, no crowd, low deniability) predicts the T1 strong-minus-weak evidence contrast (same sign)"
  }),
  fallback: "a dimension whose public pair was not decided, or whose option set was restricted by a locked option in either member, is not personalized: both items receive the intercept and the reason is recorded",
  excluded: Object.freeze(["T0 responses", "in-game private reads", "T1 responses", "T2 responses", "Mirror output", "questionnaire", "elections/office", "private profiles"])
});
var clamp3 = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
var mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
var shrink = (n, k) => n / (n + k);
var clone = (value) => JSON.parse(JSON.stringify(value));
function freezeDeep2(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep2);
    Object.freeze(value);
  }
  return value;
}
var DESIGN_RANGE = Object.freeze({ evidenceSensitivity: 0.5, partisanSymmetry: 1, crowdSusceptibility: 1, deniabilitySusceptibility: 1 });
function actorModel(actorContext) {
  validateActorContext(actorContext);
  const decided = /* @__PURE__ */ new Map();
  for (const d of actorContext.judgmentDecisions) {
    if (decided.has(d.eventId)) throw new Error(`Public judgment event ${d.eventId} decided twice`);
    decided.set(d.eventId, d);
  }
  const dimensions = {};
  const dimension = (key, fields) => {
    dimensions[key] = {
      ...fields,
      coefficient: fields.available ? ACTOR_RULE.pointsPerUnitIndex / 100 * fields.index / DESIGN_RANGE[key] : 0,
      predictedPairContrastPoints: fields.available ? ACTOR_RULE.pointsPerUnitIndex * fields.index : 0
    };
  };
  for (const [key, pair] of Object.entries(ACTOR_RULE.pairs)) {
    const high = decided.get(pair.high), low = decided.get(pair.low);
    const reasons = [];
    if (!high) reasons.push(`${pair.high} not decided`);
    if (!low) reasons.push(`${pair.low} not decided`);
    if (high && !high.allOptionsAvailable) reasons.push(`${pair.high} option set restricted by lock`);
    if (low && !low.allOptionsAvailable) reasons.push(`${pair.low} option set restricted by lock`);
    const available = reasons.length === 0;
    dimension(key, {
      source: "matched public pair",
      pairId: pair.pairId,
      events: [pair.high, pair.low],
      highChoice: high?.choiceId ?? null,
      lowChoice: low?.choiceId ?? null,
      highActionCredence: high?.actionCredence ?? null,
      lowActionCredence: low?.actionCredence ?? null,
      index: available ? high.actionCredence - low.actionCredence : 0,
      available,
      fallbackReasons: reasons
    });
  }
  const rows = ACTOR_RULE.evidence.events.map((id) => decided.get(id)).filter((d) => d && d.allOptionsAvailable);
  const evidenceReasons = ACTOR_RULE.evidence.events.filter((id) => !decided.get(id)).map((id) => `${id} not decided`).concat(ACTOR_RULE.evidence.events.filter((id) => decided.get(id) && !decided.get(id).allOptionsAvailable).map((id) => `${id} option set restricted by lock`));
  let slope = null, evidenceIndex = 0;
  const distinctQ = new Set(rows.map((r) => r.evidenceQuality));
  const evidenceAvailable = rows.length >= ACTOR_RULE.evidence.minimumEvents && distinctQ.size >= 2;
  if (evidenceAvailable) {
    const mx = mean(rows.map((r) => r.evidenceQuality)), my = mean(rows.map((r) => r.actionCredence));
    const sxx = rows.reduce((a, r) => a + (r.evidenceQuality - mx) ** 2, 0);
    slope = rows.reduce((a, r) => a + (r.evidenceQuality - mx) * (r.actionCredence - my), 0) / sxx;
    evidenceIndex = clamp3(slope * ACTOR_RULE.evidence.t1DesignRange, -1, 1);
  } else if (rows.length && rows.length < ACTOR_RULE.evidence.minimumEvents) evidenceReasons.push(`only ${rows.length} usable evidence events`);
  dimension("evidenceSensitivity", {
    source: "public action slope on frozen evidence quality",
    events: ACTOR_RULE.evidence.events,
    observations: rows.map((r) => ({ eventId: r.eventId, evidenceQuality: r.evidenceQuality, choiceId: r.choiceId, actionCredence: r.actionCredence })),
    rawSlope: slope,
    index: evidenceIndex,
    available: evidenceAvailable,
    fallbackReasons: evidenceReasons
  });
  const personalizedDimensions = Object.values(dimensions).filter((d) => d.available).length;
  return {
    source: "actor-side public judgment decisions only (projected actor context); no T0, no private reads, no T1/T2, no Mirror output",
    ruleVersion: ACTOR_RULE_VERSION,
    rule: ACTOR_RULE,
    features: { judgmentDecisions: actorContext.judgmentDecisions, publicDecisionCount: actorContext.publicDecisions.length, actionCount: actorContext.actionCount },
    meanPublicActionCredence: actorContext.judgmentDecisions.length ? mean(actorContext.judgmentDecisions.map((d) => d.actionCredence)) : null,
    intercept: ACTOR_RULE.intercept,
    dimensions,
    coverage: {
      personalizedDimensions,
      personalizedItems: personalizedDimensions * 2,
      fallbackItems: 8 - personalizedDimensions * 2,
      note: "fallback items carry no actor information and must not be counted as actor predictions"
    }
  };
}
function checkBaseline(t0, targetForm) {
  if (!Array.isArray(t0) || t0.length !== 8) throw new Error("T0 must contain eight completed item-level responses");
  const seen = /* @__PURE__ */ new Set(), forms = /* @__PURE__ */ new Set();
  const rows = t0.map((row) => {
    const item = getCase(row.caseId);
    if (item.form === targetForm) throw new Error("T0 form must be distinct from T1 holdout form");
    if (seen.has(item.id)) throw new Error(`Duplicate T0 case: ${item.id}`);
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 100) throw new Error(`Invalid T0 score: ${item.id}`);
    seen.add(item.id);
    forms.add(item.form);
    return {
      caseId: item.id,
      form: item.form,
      dimension: item.dimension,
      features: { ...item.features },
      score: row.score
    };
  });
  if (forms.size !== 1) throw new Error("T0 must use one complete parallel form");
  return rows;
}
function baselineModel(rows) {
  const n = rows.length, rawIntercept = mean(rows.map((r) => r.score / 100));
  const dimensions = {};
  for (const dimension of DIMENSIONS) {
    const pair = rows.filter((r) => r.dimension === dimension);
    const feature = dimension === "evidenceSensitivity" ? "evidence" : dimension === "partisanSymmetry" ? "partisan" : dimension === "crowdSusceptibility" ? "crowd" : "deniability";
    const ordered = [...pair].sort((a, b) => a.features[feature] - b.features[feature]);
    const rawValue = (ordered[1].score - ordered[0].score) / 100 / (ordered[1].features[feature] - ordered[0].features[feature]);
    const evidence = dimension === "evidenceSensitivity";
    const weight2 = evidence ? shrink(2, MODEL_SPEC.evidencePseudoCount) : shrink(1, MODEL_SPEC.pairPseudoCount);
    const value = evidence ? clamp3(rawValue, -1.2, 1.6) : clamp3(rawValue, -1, 1);
    dimensions[dimension] = {
      rawValue,
      boundedValue: value,
      weight: weight2,
      coefficient: value * weight2,
      n: evidence ? 2 : 1,
      available: true
    };
  }
  const weight = shrink(n, MODEL_SPEC.interceptPseudoCount);
  return {
    source: "T0 only",
    n,
    rawIntercept,
    interceptWeight: weight,
    intercept: 0.5 + weight * (rawIntercept - 0.5),
    dimensions
  };
}
function gameModel(coreState, gameLog) {
  const source = coreState?.state?.log ?? coreState?.st?.log ?? coreState?.log ?? (Array.isArray(gameLog) ? gameLog : gameLog?.canonicalLog);
  if (!Array.isArray(source)) throw new Error("Complete canonical in-game log is required for prediction");
  const inputReads = source.filter((r) => r.kind === "read");
  const validReads = inputReads.filter((r) => Number.isInteger(r.credence) && r.credence >= 0 && r.credence <= 3 && Number.isFinite(r.strength) && Number.isFinite(r.reliability));
  const moves = source.filter((r) => r.kind === "move" && r.features && typeof r.features === "object");
  const profile = analysePlayer([...validReads, ...moves]);
  const dimensions = {};
  for (const key of DIMENSIONS) {
    const dimension = profile.voter[key];
    const available = Number.isFinite(dimension.value) && dimension.n > 0;
    const weight2 = available ? shrink(dimension.n, key === "evidenceSensitivity" ? MODEL_SPEC.evidencePseudoCount : MODEL_SPEC.pairPseudoCount) : 0;
    dimensions[key] = {
      rawValue: dimension.value,
      n: dimension.n,
      available,
      weight: weight2,
      coefficient: available ? dimension.value * weight2 : 0,
      descriptiveMirrorConfidence: dimension.conf
    };
  }
  const meanCredence = mean(validReads.map((r) => MODEL_SPEC.credenceAnchors[r.credence]));
  const meanEvidence = mean(validReads.map((r) => r.strength * r.reliability));
  const evidenceSlope = dimensions.evidenceSensitivity.available ? dimensions.evidenceSensitivity.rawValue : 0;
  const rawIntercept = validReads.length ? clamp3(meanCredence + evidenceSlope * (MODEL_SPEC.evidenceReference - meanEvidence), 0, 1) : 0.5;
  const weight = shrink(validReads.length, MODEL_SPEC.interceptPseudoCount);
  return {
    source: "in-game private judgments only; political profile saved but not used as predictor",
    n: validReads.length,
    excludedReadCount: inputReads.length - validReads.length,
    meanCredence,
    meanEvidence,
    rawIntercept,
    interceptWeight: weight,
    intercept: 0.5 + weight * (rawIntercept - 0.5),
    dimensions,
    voterProfile: profile.voter,
    politicianProfile: profile.political,
    inputReadRecords: validReads.map((r) => ({
      eventId: r.eventId ?? null,
      credence: r.credence,
      strength: r.strength,
      reliability: r.reliability,
      factor: r.factor ?? null,
      pairId: r.pairId ?? null,
      level: r.level ?? null
    }))
  };
}
function predict(model, item) {
  const d = model.dimensions, x = item.features;
  return 100 * clamp3(model.intercept + d.evidenceSensitivity.coefficient * (x.evidence - MODEL_SPEC.evidenceReference) + d.partisanSymmetry.coefficient * x.partisan + d.crowdSusceptibility.coefficient * x.crowd + d.deniabilitySusceptibility.coefficient * x.deniability, 0, 1);
}
function buildPredictionCommit(input) {
  const allowed = /* @__PURE__ */ new Set(["participantId", "sessionId", "coreState", "gameLog", "t0", "form", "studyVersion", "coreHash", "timestamp", "actorContext"]);
  for (const key of Object.keys(input ?? {})) {
    if (!allowed.has(key)) throw new Error(`Prediction builder does not accept ${key}; T1/T2 data must never enter this API`);
  }
  const { participantId, sessionId, coreState, gameLog, t0, form, studyVersion, coreHash, timestamp, actorContext } = input ?? {};
  for (const [key, value] of Object.entries({ participantId, sessionId, studyVersion, coreHash })) {
    if (typeof value !== "string" || !value) throw new Error(`Prediction commit requires ${key}`);
  }
  if (!(typeof timestamp === "number" && Number.isFinite(timestamp) || typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)))) throw new Error("Prediction timestamp is required");
  const items = getCases(form);
  const baselineRows = checkBaseline(t0, form);
  const M1 = baselineModel(baselineRows);
  const M2 = gameModel(coreState, gameLog);
  const M3 = actorModel(actorContext);
  const predictions = items.map((item) => {
    const m1 = predict(M1, item), m2 = predict(M2, item), m3 = predict(M3, item);
    return {
      caseId: item.id,
      form,
      dimension: item.dimension,
      M0: { predictedScore: 50 },
      M1: { predictedScore: m1 },
      M2: { predictedScore: m2 },
      M3: { predictedScore: m3, personalized: M3.dimensions[item.dimension].available === true }
    };
  });
  return freezeDeep2(clone({
    schema: "political-mirror-prediction-commit/1",
    participantId,
    sessionId,
    studyVersion,
    coreHash,
    timestamp,
    form,
    caseBankVersion: CASE_BANK_VERSION,
    modelVersion: MODEL_VERSION,
    actorRuleVersion: ACTOR_RULE_VERSION,
    modelState: {
      spec: MODEL_SPEC,
      M0: { constant: 50 },
      M1,
      M2,
      M3,
      baselineRows,
      outcome: "deliberate-wrongdoing probability judgment",
      predictiveConfidence: null,
      confidenceNote: "No calibrated predictive intervals are estimated. Mirror confidence is descriptive coverage only."
    },
    predictions
  }));
}

// pilot/rebuild.mjs
function rebuildCommittedPredictionWith(state, prediction, buildInfo) {
  validateStudyState(state);
  if (state.stage !== "PREDICTION" || state.responses.T1.length || state.responses.T2.length) throw new Error("Predictions can only be committed before the first T1 item");
  if (state.coreGame.buildHash !== buildInfo.buildHash || state.coreGame.sourceManifestHash !== buildInfo.sourceManifestHash) throw new Error("Frozen build identity mismatch");
  const g = state.game;
  const { context, session: replayed } = extractPublicDecisionContext(g.spec, g.transcript, { returnSession: true });
  for (const [i, entry] of g.transcript.entries()) if (entry.hash && replayed.actionTranscript?.[i] && replayed.actionTranscript[i].hash !== entry.hash) throw new Error("Saved game fails exact frozen-engine replay");
  const canonical = serializeCanonicalState(replayed);
  if (replayed.phase !== "MINI_MIRROR" || stableJSON(canonical) !== stableJSON(g.canonicalState) || hashCanonicalState(replayed) !== g.canonicalHash) throw new Error("Saved game fails exact frozen-engine replay");
  return buildPredictionCommit({
    participantId: state.participantId,
    sessionId: state.sessionId,
    coreState: canonical,
    gameLog: g.telemetry,
    t0: state.responses.T0,
    form: state.assignment.formOrder[1],
    studyVersion: state.studyVersion,
    coreHash: state.coreGame.buildHash,
    timestamp: prediction.timestamp,
    actorContext: context
  });
}

// pilot-cloud/worker.mjs
var WORKER_VERSION = "pm-cloud-collector/3.2.0";
var RELEASE_VERSION = "0.38.3-storage.2";
var SCHEMA_VERSION = 6;
var MAX_BODY_BYTES = 4 * 1024 * 1024;
var SHA = (v) => sha256Hex(typeof v === "string" ? v : stableJSON(v));
var plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function failure(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}
function assert(c, code, status = 422) {
  if (!c) throw failure(status, code);
}
function safeJSON(value, depth = 0) {
  assert(depth < 100, "OBJECT_TOO_DEEP");
  if (Array.isArray(value)) {
    for (const v of value) safeJSON(v, depth + 1);
    return;
  }
  if (plain(value)) {
    for (const [k, v] of Object.entries(value)) {
      assert(!["__proto__", "prototype", "constructor"].includes(k), "UNSAFE_OBJECT_KEY");
      safeJSON(v, depth + 1);
    }
  } else assert(value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value), "INVALID_JSON_VALUE");
}
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var equal = (a, b) => stableJSON(a) === stableJSON(b);
function prefix(oldItems, newItems, label) {
  assert(Array.isArray(newItems) && newItems.length >= oldItems.length, `${label}_REMOVED`);
  for (let i = 0; i < oldItems.length; i++) assert(equal(oldItems[i], newItems[i]), `${label}_REWRITTEN`);
}
function sqlErrorText(e) {
  const parts = [];
  for (let i = 0; e && i < 5; i++, e = e.cause) parts.push(String(e.message || e));
  return parts.join(" | ");
}
var isConstraint = (e) => /UNIQUE|PRIMARY KEY|constraint|REVISION_CONFLICT/i.test(sqlErrorText(e));
function sqlGuardFailure(e) {
  const msg = sqlErrorText(e);
  const codes = {
    SESSION_REMOVED: 410,
    CONFIG_LOCKED_AFTER_FIRST_CONSENT: 409,
    CONSENT_CONFIG_MISMATCH: 409,
    RECRUITMENT_CLOSED: 403,
    NEW_ENROLLMENT_CLOSED: 403,
    CONFIG_CHANGED_RELOAD_REQUIRED: 409,
    COLLECTION_MODE_CHANGED: 409,
    REVISION_CONFLICT: 409,
    ENROLLMENT_CONFIG_NOT_READY: 403,
    RESERVATION_SESSION_MISMATCH: 503
  };
  for (const [code, status] of Object.entries(codes)) if (msg.includes(code)) return failure(status, code);
  return null;
}
function json(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    ...extra
  } });
}
async function secrets(env) {
  let row = await env.DB.prepare("SELECT runtime_key FROM private_runtime WHERE id = 1").first();
  if (!row) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const candidate = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT OR IGNORE INTO private_runtime (id, runtime_key, created_at) SELECT 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM study_run)").bind(candidate, now()).run();
    row = await env.DB.prepare("SELECT runtime_key FROM private_runtime WHERE id = 1").first();
  }
  assert(row && /^[a-f0-9]{64}$/.test(row.runtime_key), "PRIVATE_RUNTIME_MISSING_OR_INVALID: restore the existing database; do not reset", 503);
  return { runKey: row.runtime_key };
}
async function ensureRun(env, s) {
  const keyHash = sha256Hex(s.runKey);
  let row = await env.DB.prepare("SELECT * FROM study_run WHERE id = 1").first();
  if (!row) {
    const runId = "PM-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    await env.DB.prepare("INSERT OR IGNORE INTO study_run (id, run_id, run_key_sha256, study_version, active_config_sha256, recruitment_open, config_locked_at, created_at) SELECT 1, ?, ?, ?, config_sha256, CASE WHEN mode = 'HUMAN' THEN 1 ELSE 0 END, NULL, ? FROM dashboard_settings WHERE id = 1").bind(runId, keyHash, STUDY_VERSION, now()).run();
    row = await env.DB.prepare("SELECT * FROM study_run WHERE id = 1").first();
  }
  assert(row, "D1_RUN_ROW_MISSING", 503);
  assert(row.run_key_sha256 === keyHash, "RUN_KEY_CHANGED", 503);
  assert(row.study_version === STUDY_VERSION, "STUDY_VERSION_MISMATCH", 503);
  return row;
}
async function activeConfig(env, run) {
  const settings = await env.DB.prepare("SELECT mode, config_sha256 FROM dashboard_settings WHERE id = 1").first();
  assert(settings, "DASHBOARD_SETTINGS_MISSING", 503);
  assert(settings.config_sha256 === run.active_config_sha256, "CONFIG_CHANGED_RELOAD_REQUIRED", 409);
  if (!run.active_config_sha256) {
    const loaded2 = loadResearcherConfig({ schema: RESEARCHER_CONFIG_SCHEMA });
    return { ...loaded2, configured: false, mode: settings.mode, document: buildConsentDocument(loaded2.config), consentTextSha256: consentDocumentSha256(loaded2.config), snapshot: null };
  }
  const snap = await env.DB.prepare("SELECT * FROM config_snapshots WHERE researcher_config_sha256 = ?").bind(run.active_config_sha256).first();
  assert(snap, "ACTIVE_CONFIG_SNAPSHOT_MISSING", 503);
  const loaded = loadResearcherConfig(JSON.parse(snap.researcher_config_json));
  const document = buildConsentDocument(loaded.config);
  assert(loaded.sha256 === snap.researcher_config_sha256, "CONFIG_SNAPSHOT_HASH_MISMATCH", 503);
  assert(consentDocumentSha256(loaded.config) === snap.consent_text_sha256 && equal(document, JSON.parse(snap.consent_document_json)), "CONSENT_SNAPSHOT_HASH_MISMATCH", 503);
  assert(snap.study_version === STUDY_VERSION && snap.consent_template_version === CONSENT_TEMPLATE_VERSION, "CONSENT_SNAPSHOT_VERSION_MISMATCH", 503);
  return { ...loaded, configured: true, mode: settings.mode, document, consentTextSha256: snap.consent_text_sha256, snapshot: { savedAt: snap.first_seen_at, templateVersion: snap.consent_template_version } };
}
async function humanCount(env) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE is_test = 0").first()).n;
}
async function recruitmentState(env, run, cfg) {
  const allocated = await humanCount(env), target = cfg.config.recruitment.targetAllocations;
  const blockers = cfg.configured ? [...cfg.blockers] : ["RESEARCHER_CONFIG_NOT_SAVED", ...cfg.blockers];
  const open = cfg.mode === "HUMAN" && run.recruitment_open === 1 && blockers.length === 0 && allocated < target;
  const testOpen = cfg.mode === "TEST" && blockers.length === 0;
  return { allocated, target, blockers, open, testOpen, researcherOpened: cfg.mode === "HUMAN" && run.recruitment_open === 1 };
}
function rowToRecord(row) {
  return {
    sessionId: row.session_id,
    studyVersion: row.study_version,
    assignment: JSON.parse(row.assignment_json),
    consentConfig: JSON.parse(row.consent_config_json),
    consent: row.consent_json ? JSON.parse(row.consent_json) : null,
    isTest: row.is_test === 1,
    removedAt: row.removed_at || null,
    revision: row.revision,
    checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null,
    prediction: row.prediction_json ? JSON.parse(row.prediction_json) : null,
    predictionReceipt: row.prediction_receipt_json ? JSON.parse(row.prediction_receipt_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tokenHash: row.token_hash,
    lastEventSha256: row.last_event_sha256,
    slot: row.slot,
    stage: row.stage,
    status: row.status
  };
}
var responseView = (r) => ({
  sessionId: r.sessionId,
  studyVersion: r.studyVersion,
  assignment: r.assignment,
  consentConfig: r.consentConfig,
  consent: r.consent,
  test: r.isTest,
  revision: r.revision,
  checkpoint: r.checkpoint,
  prediction: r.prediction,
  predictionReceipt: r.predictionReceipt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
});
var exportView = (r) => ({ schema: "political-mirror-research-export/1", collector: WORKER_VERSION, exportedAt: now(), ...responseView(r), simulated: r.isTest, removedAt: r.removedAt, journalHeadSha256: r.lastEventSha256, journalSequence: r.revision });
async function readBody(request) {
  assert(/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""), "JSON_CONTENT_TYPE_REQUIRED", 415);
  assert(Number(request.headers.get("content-length") || 0) <= MAX_BODY_BYTES, "BODY_TOO_LARGE", 413);
  const raw = await request.text();
  assert(raw.length <= MAX_BODY_BYTES, "BODY_TOO_LARGE", 413);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw failure(400, "INVALID_JSON");
  }
  assert(plain(parsed), "OBJECT_REQUIRED", 400);
  safeJSON(parsed);
  return parsed;
}
async function loadSession(env, id) {
  assert(/^[a-f0-9-]{36}$/.test(id || ""), "SESSION_NOT_FOUND", 404);
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE session_id = ?").bind(id).first();
  return row ? rowToRecord(row) : null;
}
function authenticate(request, record, { allowRemoved = false } = {}) {
  const supplied = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
  const attempted = SHA(supplied?.[1] || "");
  assert(supplied && record && timingSafeEqualString(record.tokenHash, attempted), "INVALID_SESSION_CREDENTIALS", 401);
  assert(allowRemoved || !record.removedAt, "SESSION_REMOVED", 410);
}
function validateIdentity(state, r) {
  assert(state.sessionId === r.sessionId && state.participantId === r.sessionId, "SESSION_ID_MISMATCH");
  assert(state.studyVersion === STUDY_VERSION, "STUDY_VERSION_MISMATCH");
  assert(consentRecordIsComplete(state.consent) && state.consent.version === CONSENT_VERSION, "CONSENT_INCOMPLETE");
  assert(equal(state.consent, r.consent), "CONSENT_RECORD_MISMATCH");
  assert(state.coreGame?.buildHash === build_info_default.buildHash && state.coreGame?.sourceManifestHash === build_info_default.sourceManifestHash, "FROZEN_BUILD_MISMATCH");
  assert(equal(state.assignment, r.assignment), "ASSIGNMENT_MISMATCH");
  try {
    validateStudyState(state, { predictionCommitted: !!r.prediction });
  } catch (e) {
    throw failure(422, "INVALID_STUDY_STATE: " + String(e.message).slice(0, 180));
  }
}
function validateEvolution(old, next, r) {
  try {
    validateStudyTransition(old, next, { predictionCommitted: !!r.prediction });
  } catch (e) {
    throw failure(422, "INVALID_TRANSITION: " + String(e.message).slice(0, 180));
  }
  assert((next.responses?.T1?.length || 0) === 0 || r.prediction, "T1_BEFORE_PREDICTION_COMMIT", 409);
  if (next.prediction != null) assert(r.prediction && equal(next.prediction, r.prediction), "PREDICTION_MISMATCH", 409);
  if (next.predictionReceipt != null) assert(equal(next.predictionReceipt, r.predictionReceipt), "PREDICTION_RECEIPT_MISMATCH", 409);
  if (STAGES.indexOf(next.stage) >= STAGES.indexOf("T1") && next.stage !== "WITHDRAWN") assert(r.prediction && equal(next.prediction, r.prediction) && equal(next.predictionReceipt, r.predictionReceipt), "UNCOMMITTED_T1_STAGE", 409);
  if (next.presentation?.block === "T1") assert(r.prediction, "T1_PRESENTATION_BEFORE_COMMIT", 409);
  if (!old) {
    assert(next.stage === "T0" && next.responses.T0.length === 0 && (next.events || []).length <= 2, "INITIAL_STATE_MUST_BE_CONSENTED_T0");
    return;
  }
  for (const k of ["schema", "studyVersion", "coreGame", "consentVersion", "participantId", "sessionId", "assignment", "consent"]) assert(equal(old[k], next[k]), `${k.toUpperCase()}_IMMUTABLE`);
  for (const block of ["T0", "T1", "T2"]) prefix(old.responses[block], next.responses[block], block + "_RESPONSES");
  prefix(old.events || [], next.events || [], "EVENTS");
  prefix(old.technicalErrors || [], next.technicalErrors || [], "TECHNICAL_ERRORS");
  assert(old.timestamps.createdAt === next.timestamps.createdAt, "CREATION_TIME_IMMUTABLE");
  const before = STAGES.indexOf(old.stage), after = STAGES.indexOf(next.stage);
  assert(next.stage === "WITHDRAWN" || before >= 0 && after >= before && after <= before + 1, "INVALID_STAGE_TRANSITION");
  if (["COMPLETE", "WITHDRAWN"].includes(old.stage)) assert(equal(old, next), "TERMINAL_STATE_IMMUTABLE");
  if (old.game) {
    assert(next.game, "GAME_REMOVED");
    for (const k of ["schema", "sessionId", "arm", "spec"]) assert(equal(old.game[k], next.game[k]), "GAME_IDENTITY_IMMUTABLE");
    if (Array.isArray(old.game.transcript)) prefix(old.game.transcript, next.game.transcript, "GAME_TRANSCRIPT");
    if (before >= STAGES.indexOf("PREDICTION")) for (const k of ["canonicalState", "canonicalHash", "transcript", "mirror"]) assert(equal(old.game[k], next.game[k]), "COMPLETED_GAME_IMMUTABLE");
  }
}
function eventStatement(env, r, sequence, type, requestId, at, record, summary) {
  const recordSha = SHA(record);
  return { recordSha, statement: env.DB.prepare("INSERT INTO session_events (session_id, sequence, type, request_id, at, revision, stage, record_sha256, previous_sha256, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(r.sessionId, sequence, type, requestId, at, sequence, record.checkpoint?.stage ?? r.stage ?? null, recordSha, r.lastEventSha256 ?? null, JSON.stringify(summary)) };
}
async function replayOrThrow(env, r, requestId, kind, input) {
  const seen = await env.DB.prepare("SELECT digest, result_json FROM session_requests WHERE session_id = ? AND request_id = ?").bind(r.sessionId, requestId).first();
  if (!seen) return null;
  assert(seen.digest === SHA({ kind, input }), "REQUEST_ID_REUSED_WITH_DIFFERENT_BODY", 409);
  return JSON.parse(seen.result_json);
}
async function removeParticipantData(env, r) {
  if (!r.removedAt) {
    try {
      await env.DB.batch([env.DB.prepare(`
        INSERT INTO pm_remove_data(session_id,note)
        SELECT session_id,json_object('cause','participant_withdrawal',
          'sawFeedback',CASE WHEN stage IN ('T2','SURVEY','DEBRIEF','COMPLETE')
            OR json_extract(checkpoint_json,'$.game.telemetry.mirrorPresentedAt') IS NOT NULL THEN 1 ELSE 0 END,
          'feedbackArm',CASE WHEN stage IN ('T2','SURVEY','DEBRIEF','COMPLETE')
            OR json_extract(checkpoint_json,'$.game.telemetry.mirrorPresentedAt') IS NOT NULL THEN arm ELSE NULL END)
        FROM sessions WHERE session_id=? AND removed_at IS NULL
      `).bind(r.sessionId)]);
    } catch (_) {
      throw failure(503, "WITHDRAWAL_NOT_CONFIRMED");
    }
  }
  const row = await env.DB.prepare("SELECT session_id,slot,is_test,study_version,revision,removed_at,removal_note FROM sessions WHERE session_id=?").bind(r.sessionId).first();
  assert(row?.removed_at, "WITHDRAWAL_NOT_CONFIRMED", 503);
  let note = {};
  try {
    note = JSON.parse(row.removal_note || "{}");
  } catch {
  }
  const sawFeedback = note.sawFeedback === 1;
  return {
    schema: "pm-withdrawal-receipt/1",
    sessionId: row.session_id,
    participantCode: (row.is_test ? "TEST" : "P") + String(row.is_test ? row.slot - 1e6 + 1 : row.slot + 1).padStart(3, "0"),
    studyVersion: row.study_version,
    revision: row.revision,
    removedAt: row.removed_at,
    dataDeleted: true,
    status: "withdrawn",
    sawFeedback,
    feedbackArm: sawFeedback && ["TRUE", "SHUFFLED"].includes(note.feedbackArm) ? note.feedbackArm : null
  };
}
async function handleEnroll(env, s, run, cfg, request) {
  const input = await readBody(request);
  assert(Object.keys(input).every((k) => ["requestId", "consent", "collectionMode"].includes(k)), "UNKNOWN_ENROLLMENT_FIELD");
  assert(typeof input.requestId === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(input.requestId), "INVALID_ENROLLMENT_KEY", 400);
  const enrollmentHash = SHA(input.requestId);
  const existing = await env.DB.prepare("SELECT * FROM sessions WHERE enrollment_hash = ?").bind(enrollmentHash).first();
  if (existing) {
    const r = rowToRecord(existing);
    assert(!r.removedAt, "SESSION_REMOVED", 410);
    return json(200, { ...responseView(r), token: enrollmentToken(s.runKey, r.sessionId, input.requestId) });
  }
  let consent;
  try {
    consent = validateConsentSubmission(input.consent, { researcherConfigSha256: cfg.sha256, consentTextSha256: cfg.consentTextSha256 });
  } catch (e) {
    throw failure(e.message === "CONSENT_CONFIG_MISMATCH" ? 409 : 422, e.message);
  }
  assert(input.collectionMode === cfg.mode && ["TEST", "HUMAN"].includes(input.collectionMode), "COLLECTION_MODE_CHANGED", 409);
  assert(cfg.blockers.length === 0 && cfg.configured, "ENROLLMENT_BLOCKED: " + cfg.blockers.join(","), 403);
  const isTest = cfg.mode === "TEST";
  if (!isTest) {
    const rec = await recruitmentState(env, run, cfg);
    assert(rec.blockers.length === 0, "ENROLLMENT_BLOCKED: " + rec.blockers.join(","), 403);
    assert(rec.researcherOpened, "RECRUITMENT_CLOSED", 403);
    assert(rec.allocated < rec.target, "NEW_ENROLLMENT_CLOSED", 403);
  }
  const table = isTest ? "test_slot_reservations" : "slot_reservations";
  const cap = isTest ? 1e5 : cfg.config.recruitment.targetAllocations;
  for (let attempt = 0; attempt < 32; attempt++) {
    const counts = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(slot), -1) + 1 AS next_slot FROM ${table}`).first();
    assert(counts.n === counts.next_slot, "ALLOCATION_INTEGRITY_ERROR: run the read-only integrity check", 503);
    if (counts.n >= cap) {
      const existingAtCap = await env.DB.prepare("SELECT * FROM sessions WHERE enrollment_hash = ?").bind(enrollmentHash).first();
      if (existingAtCap) {
        const r = rowToRecord(existingAtCap);
        assert(!r.removedAt, "SESSION_REMOVED", 410);
        return json(200, { ...responseView(r), token: enrollmentToken(s.runKey, r.sessionId, input.requestId) });
      }
      throw failure(403, "NEW_ENROLLMENT_CLOSED");
    }
    const slot = counts.next_slot, sessionId = crypto.randomUUID(), at = now();
    const assignment = assignmentForSlot(slot, isTest ? s.runKey + "|TEST-SESSIONS" : s.runKey, run.run_id);
    if (isTest) assignment.test = true;
    const token = enrollmentToken(s.runKey, sessionId, input.requestId);
    const consentRecord = { ...consent, at, version: CONSENT_VERSION };
    const consentConfig = {
      consentVersion: CONSENT_VERSION,
      consentTemplateVersion: CONSENT_TEMPLATE_VERSION,
      consentTextSha256: cfg.consentTextSha256,
      researcherConfigSha256: cfg.sha256,
      studyTitle: cfg.config.studyTitle,
      ethicsArrangement: cfg.config.ethics.arrangement,
      ethicsReference: cfg.config.ethics.reference,
      ethicsBody: cfg.config.ethics.body,
      testSession: isTest
    };
    const record = {
      schema: "pm-collected-session/1",
      sessionId,
      studyVersion: STUDY_VERSION,
      assignment,
      consentConfig,
      consent: consentRecord,
      test: isTest,
      createdAt: at,
      updatedAt: at,
      revision: 0,
      checkpoint: null,
      prediction: null,
      predictionReceipt: null
    };
    const recordSha = SHA(record);
    const statements = [
      env.DB.prepare(`INSERT INTO ${table} (slot, enrollment_hash, at) VALUES (?, ?, ?)`).bind(slot, enrollmentHash, at),
      env.DB.prepare("INSERT INTO sessions (session_id, slot, run_id, arm, form_order, assignment_json, enrollment_hash, token_hash, study_version, consent_config_json, consent_json, is_test, revision, stage, status, consented_at, last_event_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)").bind(sessionId, isTest ? 1e6 + slot : slot, run.run_id, assignment.arm, assignment.formOrder.join(""), JSON.stringify(assignment), enrollmentHash, SHA(token), STUDY_VERSION, JSON.stringify(consentConfig), JSON.stringify(consentRecord), isTest ? 1 : 0, "consented_no_checkpoint", at, recordSha, at, at),
      env.DB.prepare("INSERT INTO consent_records (session_id, consent_version, consent_text_sha256, researcher_config_sha256, consent_json, consented_at, recorded_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)").bind(sessionId, CONSENT_VERSION, cfg.consentTextSha256, cfg.sha256, JSON.stringify(consentRecord), at, at),
      env.DB.prepare("INSERT INTO session_events (session_id, sequence, type, request_id, at, revision, stage, record_sha256, previous_sha256, summary_json) VALUES (?, 0, ?, NULL, ?, 0, NULL, ?, NULL, ?)").bind(sessionId, "session-created", at, recordSha, JSON.stringify({ slot, arm: assignment.arm, formOrder: assignment.formOrder, test: isTest, consentTextSha256: cfg.consentTextSha256 }))
    ];
    if (!isTest) statements.push(env.DB.prepare("UPDATE study_run SET config_locked_at = COALESCE(config_locked_at, ?) WHERE id = 1").bind(at));
    try {
      await env.DB.batch(statements);
    } catch (e) {
      const guard = sqlGuardFailure(e);
      if (guard) throw guard;
      const dup = await env.DB.prepare("SELECT * FROM sessions WHERE enrollment_hash = ?").bind(enrollmentHash).first();
      if (dup) {
        const r = rowToRecord(dup);
        assert(!r.removedAt, "SESSION_REMOVED", 410);
        return json(200, { ...responseView(r), token: enrollmentToken(s.runKey, r.sessionId, input.requestId) });
      }
      if (isConstraint(e) && /slot_reservations|sessions\.slot/.test(sqlErrorText(e))) continue;
      throw failure(503, "D1_WRITE_FAILED");
    }
    return json(201, {
      sessionId,
      studyVersion: STUDY_VERSION,
      assignment,
      consentConfig,
      consent: consentRecord,
      test: isTest,
      revision: 0,
      checkpoint: null,
      prediction: null,
      predictionReceipt: null,
      createdAt: at,
      updatedAt: at,
      token
    });
  }
  throw failure(503, "ENROLLMENT_BUSY_RETRY_SAME_KEY");
}
async function handleWrite(env, s, request, r, kind) {
  const input = await readBody(request);
  assert(typeof input.requestId === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(input.requestId), "INVALID_REQUEST_ID", 400);
  assert(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, "INVALID_REVISION", 400);
  assert(Object.keys(input).every((k) => ["requestId", "expectedRevision", kind].includes(k)), "UNKNOWN_REQUEST_FIELD", 400);
  const replay = await replayOrThrow(env, r, input.requestId, kind, input);
  if (replay) return json(200, replay);
  assert(input.expectedRevision === r.revision, "REVISION_CONFLICT", 409);
  const revision = r.revision + 1, at = now(), digest = SHA({ kind, input });
  const statements = [];
  let result, nextRecord;
  if (kind === "checkpoint") {
    assert(plain(input.checkpoint), "CHECKPOINT_REQUIRED");
    validateIdentity(input.checkpoint, r);
    validateEvolution(r.checkpoint, input.checkpoint, r);
    const cp = input.checkpoint;
    if (cp.stage === "WITHDRAWN") return json(200, await removeParticipantData(env, r));
    nextRecord = { ...responseView(r), revision, updatedAt: at, checkpoint: cp };
    result = { revision, predictionCommitted: !!r.prediction, ...r.predictionReceipt ? { committedAt: r.predictionReceipt.committedAt, predictionSha256: r.predictionReceipt.predictionSha256, predictionReceipt: r.predictionReceipt } : {} };
    const summary = {
      stage: cp.stage,
      status: cp.status,
      presentation: cp.presentation?.block ?? null,
      responses: { T0: cp.responses.T0.length, T1: cp.responses.T1.length, T2: cp.responses.T2.length },
      actions: cp.game?.transcript?.length ?? 0,
      events: cp.events.length,
      technicalErrors: cp.technicalErrors.length,
      withdrawal: cp.withdrawal ? { reason: cp.withdrawal.reason, stageAtStop: cp.withdrawal.stageAtStop, sawFeedback: cp.withdrawal.sawFeedback, dataRemovalRequested: cp.withdrawal.dataRemovalRequested } : null
    };
    const ev = eventStatement(env, r, revision, "checkpoint", input.requestId, at, nextRecord, summary);
    statements.push(env.DB.prepare("UPDATE sessions SET revision = ?, checkpoint_json = ?, checkpoint_sha256 = ?, stage = ?, status = ?, technical_error_count = ?, last_event_sha256 = ?, updated_at = ? WHERE session_id = ?").bind(revision, JSON.stringify(cp), SHA(cp), cp.stage, cp.status, cp.technicalErrors.length, ev.recordSha, at, r.sessionId));
    statements.push(ev.statement);
  } else {
    assert(plain(input.prediction), "PREDICTION_REQUIRED");
    assert(!r.prediction, "PREDICTION_ALREADY_COMMITTED", 409);
    assert(r.checkpoint?.stage === "PREDICTION" && (r.checkpoint.responses?.T1?.length || 0) === 0, "INVALID_PREDICTION_STAGE", 409);
    let rebuilt;
    try {
      rebuilt = rebuildCommittedPredictionWith(r.checkpoint, input.prediction, build_info_default);
    } catch (e) {
      throw failure(422, "PREDICTION_VALIDATION_FAILED: " + String(e.message).slice(0, 180));
    }
    assert(equal(rebuilt, input.prediction), "PREDICTION_REBUILD_MISMATCH", 409);
    const p = input.prediction, predictionSha256 = SHA(p);
    const receipt = { committedAt: at, predictionSha256, sessionId: r.sessionId, studyVersion: STUDY_VERSION, revision, collector: WORKER_VERSION };
    nextRecord = { ...responseView(r), revision, updatedAt: at, prediction: p, predictionReceipt: receipt };
    result = { revision, predictionCommitted: true, committedAt: at, predictionSha256, predictionReceipt: receipt };
    const ev = eventStatement(env, r, revision, "prediction", input.requestId, at, nextRecord, { modelVersion: p.modelVersion, actorRuleVersion: p.actorRuleVersion, form: p.form, personalizedItems: p.modelState?.M3?.coverage?.personalizedItems ?? null });
    statements.push(env.DB.prepare("INSERT INTO prediction_commits (session_id, prediction_sha256, model_version, actor_rule_version, case_bank_version, study_version, core_hash, form, committed_at, revision, commit_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(r.sessionId, predictionSha256, p.modelVersion, p.actorRuleVersion, p.caseBankVersion, p.studyVersion, p.coreHash, p.form, at, revision, JSON.stringify(p)));
    const rows = p.predictions.map((row, i) => [r.sessionId, row.caseId, i, row.dimension, row.M0.predictedScore, row.M1.predictedScore, row.M2.predictedScore, row.M3.predictedScore, row.M3.personalized ? 1 : 0]);
    statements.push(env.DB.prepare("INSERT INTO prediction_items (session_id, case_id, position, dimension, m0, m1, m2, m3, m3_personalized) VALUES " + rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")).bind(...rows.flat()));
    statements.push(env.DB.prepare("UPDATE sessions SET revision = ?, prediction_json = ?, prediction_receipt_json = ?, last_event_sha256 = ?, updated_at = ? WHERE session_id = ?").bind(revision, JSON.stringify(p), JSON.stringify(receipt), ev.recordSha, at, r.sessionId));
    statements.push(ev.statement);
  }
  statements.push(env.DB.prepare("INSERT INTO session_requests (session_id, request_id, kind, digest, result_json, at) VALUES (?, ?, ?, ?, ?, ?)").bind(r.sessionId, input.requestId, kind, digest, JSON.stringify(result), at));
  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (e) {
    const current = await loadSession(env, r.sessionId);
    assert(current && !current.removedAt, "SESSION_REMOVED", 410);
    const guard = sqlGuardFailure(e);
    if (guard && guard.code !== "REVISION_CONFLICT") throw guard;
    if (!isConstraint(e)) throw failure(503, "D1_WRITE_FAILED");
    const replayed = await replayOrThrow(env, r, input.requestId, kind, input);
    if (replayed) return json(200, replayed);
    throw failure(409, kind === "prediction" && /prediction_commits/.test(String(e.message)) ? "PREDICTION_ALREADY_COMMITTED" : "REVISION_CONFLICT");
  }
  assert(results[kind === "checkpoint" ? 0 : 2]?.meta?.changes === 1, "D1_UPDATE_DID_NOT_APPLY", 503);
  return json(200, result);
}
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/researcher.html" || url.pathname === "/api/researcher" || url.pathname.startsWith("/api/researcher/") || url.pathname.startsWith("/api/admin/")) return json(404, { error: "NOT_FOUND" });
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      assert(env.DB, "D1_BINDING_DB_MISSING", 503);
      assert(request.headers.get("sec-fetch-site") !== "cross-site", "CROSS_ORIGIN_REQUEST", 403);
      const origin = request.headers.get("origin");
      if (origin) {
        let o;
        try {
          o = new URL(origin);
        } catch {
          throw failure(403, "INVALID_ORIGIN");
        }
        assert(o.host === url.host, "CROSS_ORIGIN_REQUEST", 403);
      }
      const schema = await ensureStorage(env, request.url);
      assert(schema.version === SCHEMA_VERSION, "INCOMPATIBLE_DATABASE", 503);
      const s = await secrets(env);
      const run = await ensureRun(env, s);
      const cfg = await activeConfig(env, run);
      if (url.pathname === "/api/health" && request.method === "GET") {
        const rec = await recruitmentState(env, run, cfg);
        return json(200, { ok: true, releaseVersion: RELEASE_VERSION, collector: WORKER_VERSION, studyVersion: STUDY_VERSION, schemaVersion: schema.version, runId: run.run_id, configured: cfg.configured, recruitmentOpen: rec.open, blockers: rec.blockers, management: "cloudflare-account-only", manualSecretsRequired: false, manualSQLRequired: false, recordsTable: "participants", automaticDatabaseSetup: true, mode: cfg.mode, testOpen: rec.testOpen });
      }
      if (url.pathname === "/api/config" && request.method === "GET") {
        const rec = await recruitmentState(env, run, cfg), c = cfg.config;
        return json(200, {
          studyVersion: STUDY_VERSION,
          collector: WORKER_VERSION,
          collectionMode: cfg.mode,
          storage: "cloudflare-pages-d1",
          predictionCommitRequired: true,
          maxBodyBytes: MAX_BODY_BYTES,
          serverTime: now(),
          configured: cfg.configured,
          allowedNewEnroll: rec.open || rec.testOpen,
          maxParticipants: rec.target,
          enrollmentBlockers: rec.blockers,
          runId: run.run_id,
          researcher: {
            studyTitle: c.studyTitle,
            principalInvestigator: c.principalInvestigator,
            institution: c.institution,
            contactEmail: c.contactEmail,
            estimatedDurationMinutes: c.estimatedDurationMinutes,
            durationEstimateBasis: c.durationEstimateBasis,
            dataRetention: c.dataRetention,
            dataAccess: c.dataAccess,
            withdrawalProcedure: c.withdrawalProcedure,
            ethics: c.ethics,
            sha256: cfg.sha256
          },
          consentDocument: cfg.document,
          consentTextSha256: cfg.consentTextSha256,
          consentTemplateVersion: CONSENT_TEMPLATE_VERSION,
          contactEmail: c.contactEmail,
          consentVersion: CONSENT_VERSION
        });
      }
      if (url.pathname === "/api/session" && request.method === "POST") return await handleEnroll(env, s, run, cfg, request);
      const match = /^\/api\/session\/([^/]+)(?:\/(checkpoint|prediction|export|withdraw))?$/.exec(url.pathname);
      assert(match, "NOT_FOUND", 404);
      const record = await loadSession(env, match[1]);
      authenticate(request, record, { allowRemoved: match[2] === "withdraw" });
      if (match[2] === "withdraw") {
        assert(request.method === "POST", "METHOD_NOT_ALLOWED", 405);
        const body = await readBody(request);
        assert(Object.keys(body).every((k) => k === "requestId") && typeof body.requestId === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(body.requestId), "INVALID_WITHDRAWAL_REQUEST", 422);
        return json(200, await removeParticipantData(env, record));
      }
      if (request.method === "GET" && !match[2]) return json(200, responseView(record));
      if (request.method === "GET" && match[2] === "export") return json(200, exportView(record));
      assert(request.method === "POST" && ["checkpoint", "prediction"].includes(match[2]), "METHOD_NOT_ALLOWED", 405);
      return await handleWrite(env, s, request, record, match[2]);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(`[pm-collector] ${status} ${url.pathname}: ${String(e && e.message).slice(0, 300)}`);
      return json(status, { error: e.code || (e.status ? "INVALID_REQUEST" : "INTERNAL_ERROR") });
    }
  }
};
export {
  worker_default as default
};
