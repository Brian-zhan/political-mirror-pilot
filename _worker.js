// Political Mirror backend release 0.38.3-storage.2; compiled from source with TypeScript 5.8.3.
// User-confirmed consent and withdrawal-deletion release; frozen core and M3 unchanged.
const __modules = {
"pilot-cloud/worker.mjs": [{"../pilot/build-info.json":"pilot/build-info.json","./auto-storage.mjs":"pilot-cloud/auto-storage.mjs","../pilot/study.mjs":"pilot/study.mjs","../pilot/rebuild.mjs":"pilot/rebuild.mjs","../pilot/assignment.mjs":"pilot/assignment.mjs","../pilot/sha256.mjs":"pilot/sha256.mjs","../pilot/researcher-config.mjs":"pilot/researcher-config.mjs","../pilot/consent-text.mjs":"pilot/consent-text.mjs","../pilot/consent-validator.mjs":"pilot/consent-validator.mjs","../pilot/cases.mjs":"pilot/cases.mjs"}, function(module, exports, require) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Political Mirror CX-style management: Cloudflare D1 Console only.
// No public researcher API or researcher login; no user-supplied secret settings.
// Study/core/M3 unchanged. Account-authenticated SQL configures, exports and removes data.
const build_info_json_1 = __importDefault(require("../pilot/build-info.json"));
const auto_storage_mjs_1 = require("./auto-storage.mjs");
const study_mjs_1 = require("../pilot/study.mjs");
const rebuild_mjs_1 = require("../pilot/rebuild.mjs");
const assignment_mjs_1 = require("../pilot/assignment.mjs");
const sha256_mjs_1 = require("../pilot/sha256.mjs");
const researcher_config_mjs_1 = require("../pilot/researcher-config.mjs");
const consent_text_mjs_1 = require("../pilot/consent-text.mjs");
const consent_validator_mjs_1 = require("../pilot/consent-validator.mjs");
const cases_mjs_1 = require("../pilot/cases.mjs");
const WORKER_VERSION = 'pm-cloud-collector/3.2.0';
const RELEASE_VERSION = '0.38.3-storage.2'; // backend release; participant protocol remains pilot.2
const SCHEMA_VERSION = 6;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SHA = (v) => (0, sha256_mjs_1.sha256Hex)(typeof v === 'string' ? v : (0, assignment_mjs_1.stableJSON)(v));
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function failure(status, code) { const e = new Error(code); e.status = status; e.code = code; return e; }
function assert(c, code, status = 422) { if (!c)
    throw failure(status, code); }
function safeJSON(value, depth = 0) {
    assert(depth < 100, 'OBJECT_TOO_DEEP');
    if (Array.isArray(value)) {
        for (const v of value)
            safeJSON(v, depth + 1);
        return;
    }
    if (plain(value)) {
        for (const [k, v] of Object.entries(value)) {
            assert(!['__proto__', 'prototype', 'constructor'].includes(k), 'UNSAFE_OBJECT_KEY');
            safeJSON(v, depth + 1);
        }
    }
    else
        assert(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)), 'INVALID_JSON_VALUE');
}
const now = () => new Date().toISOString();
const equal = (a, b) => (0, assignment_mjs_1.stableJSON)(a) === (0, assignment_mjs_1.stableJSON)(b);
function prefix(oldItems, newItems, label) {
    assert(Array.isArray(newItems) && newItems.length >= oldItems.length, `${label}_REMOVED`);
    for (let i = 0; i < oldItems.length; i++)
        assert(equal(oldItems[i], newItems[i]), `${label}_REWRITTEN`);
}
function sqlErrorText(e) {
    const parts = [];
    for (let i = 0; e && i < 5; i++, e = e.cause)
        parts.push(String(e.message || e));
    return parts.join(' | ');
}
const isConstraint = (e) => /UNIQUE|PRIMARY KEY|constraint|REVISION_CONFLICT/i.test(sqlErrorText(e));
function sqlGuardFailure(e) {
    const msg = sqlErrorText(e);
    const codes = { SESSION_REMOVED: 410, CONFIG_LOCKED_AFTER_FIRST_CONSENT: 409,
        CONSENT_CONFIG_MISMATCH: 409, RECRUITMENT_CLOSED: 403, NEW_ENROLLMENT_CLOSED: 403,
        CONFIG_CHANGED_RELOAD_REQUIRED: 409, COLLECTION_MODE_CHANGED: 409, REVISION_CONFLICT: 409,
        ENROLLMENT_CONFIG_NOT_READY: 403, RESERVATION_SESSION_MISMATCH: 503 };
    for (const [code, status] of Object.entries(codes))
        if (msg.includes(code))
            return failure(status, code);
    return null;
}
function json(status, payload, extra = {}) {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', ...extra } });
}
function text(status, body, type) {
    return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } });
}
// Only the account-authenticated D1 Console can manage the site. A private 256-bit
// runtime secret is generated once with Web Crypto, stored in D1 and never exported.
// Absence after initialisation fails closed; a deployment must not silently rotate it.
async function secrets(env) {
    let row = await env.DB.prepare('SELECT runtime_key FROM private_runtime WHERE id = 1').first();
    if (!row) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const candidate = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        await env.DB.prepare("INSERT OR IGNORE INTO private_runtime (id, runtime_key, created_at) SELECT 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM study_run)").bind(candidate, now()).run();
        row = await env.DB.prepare('SELECT runtime_key FROM private_runtime WHERE id = 1').first();
    }
    assert(row && /^[a-f0-9]{64}$/.test(row.runtime_key), 'PRIVATE_RUNTIME_MISSING_OR_INVALID: restore the existing database; do not reset', 503);
    return { runKey: row.runtime_key };
}
// ---------- run row; immutable consent snapshots provided via D1 Console ----------
async function ensureRun(env, s) {
    const keyHash = (0, sha256_mjs_1.sha256Hex)(s.runKey);
    let row = await env.DB.prepare('SELECT * FROM study_run WHERE id = 1').first();
    if (!row) {
        const runId = 'PM-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
        // Read settings inside the statement (not a stale JS snapshot).
        await env.DB.prepare("INSERT OR IGNORE INTO study_run (id, run_id, run_key_sha256, study_version, active_config_sha256, recruitment_open, config_locked_at, created_at) SELECT 1, ?, ?, ?, config_sha256, CASE WHEN mode = 'HUMAN' THEN 1 ELSE 0 END, NULL, ? FROM dashboard_settings WHERE id = 1").bind(runId, keyHash, study_mjs_1.STUDY_VERSION, now()).run();
        row = await env.DB.prepare('SELECT * FROM study_run WHERE id = 1').first();
    }
    assert(row, 'D1_RUN_ROW_MISSING', 503);
    assert(row.run_key_sha256 === keyHash, 'RUN_KEY_CHANGED', 503);
    assert(row.study_version === study_mjs_1.STUDY_VERSION, 'STUDY_VERSION_MISMATCH', 503);
    return row;
}
async function activeConfig(env, run) {
    const settings = await env.DB.prepare('SELECT mode, config_sha256 FROM dashboard_settings WHERE id = 1').first();
    assert(settings, 'DASHBOARD_SETTINGS_MISSING', 503);
    assert(settings.config_sha256 === run.active_config_sha256, 'CONFIG_CHANGED_RELOAD_REQUIRED', 409);
    if (!run.active_config_sha256) {
        const loaded = (0, researcher_config_mjs_1.loadResearcherConfig)({ schema: researcher_config_mjs_1.RESEARCHER_CONFIG_SCHEMA });
        return { ...loaded, configured: false, mode: settings.mode, document: (0, consent_text_mjs_1.buildConsentDocument)(loaded.config), consentTextSha256: (0, consent_text_mjs_1.consentDocumentSha256)(loaded.config), snapshot: null };
    }
    const snap = await env.DB.prepare('SELECT * FROM config_snapshots WHERE researcher_config_sha256 = ?').bind(run.active_config_sha256).first();
    assert(snap, 'ACTIVE_CONFIG_SNAPSHOT_MISSING', 503);
    const loaded = (0, researcher_config_mjs_1.loadResearcherConfig)(JSON.parse(snap.researcher_config_json));
    const document = (0, consent_text_mjs_1.buildConsentDocument)(loaded.config);
    assert(loaded.sha256 === snap.researcher_config_sha256, 'CONFIG_SNAPSHOT_HASH_MISMATCH', 503);
    assert((0, consent_text_mjs_1.consentDocumentSha256)(loaded.config) === snap.consent_text_sha256 && equal(document, JSON.parse(snap.consent_document_json)), 'CONSENT_SNAPSHOT_HASH_MISMATCH', 503);
    assert(snap.study_version === study_mjs_1.STUDY_VERSION && snap.consent_template_version === consent_text_mjs_1.CONSENT_TEMPLATE_VERSION, 'CONSENT_SNAPSHOT_VERSION_MISMATCH', 503);
    return { ...loaded, configured: true, mode: settings.mode, document, consentTextSha256: snap.consent_text_sha256, snapshot: { savedAt: snap.first_seen_at, templateVersion: snap.consent_template_version } };
}
async function humanCount(env) { return (await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE is_test = 0').first()).n; }
async function recruitmentState(env, run, cfg) {
    const allocated = await humanCount(env), target = cfg.config.recruitment.targetAllocations;
    const blockers = cfg.configured ? [...cfg.blockers] : ['RESEARCHER_CONFIG_NOT_SAVED', ...cfg.blockers];
    const open = cfg.mode === 'HUMAN' && run.recruitment_open === 1 && blockers.length === 0 && allocated < target;
    const testOpen = cfg.mode === 'TEST' && blockers.length === 0;
    return { allocated, target, blockers, open, testOpen, researcherOpened: cfg.mode === 'HUMAN' && run.recruitment_open === 1 };
}
// ---------- records ----------
function rowToRecord(row) {
    return { sessionId: row.session_id, studyVersion: row.study_version, assignment: JSON.parse(row.assignment_json), consentConfig: JSON.parse(row.consent_config_json),
        consent: row.consent_json ? JSON.parse(row.consent_json) : null, isTest: row.is_test === 1, removedAt: row.removed_at || null,
        revision: row.revision, checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null, prediction: row.prediction_json ? JSON.parse(row.prediction_json) : null,
        predictionReceipt: row.prediction_receipt_json ? JSON.parse(row.prediction_receipt_json) : null, createdAt: row.created_at, updatedAt: row.updated_at,
        tokenHash: row.token_hash, lastEventSha256: row.last_event_sha256, slot: row.slot, stage: row.stage, status: row.status };
}
const responseView = (r) => ({ sessionId: r.sessionId, studyVersion: r.studyVersion, assignment: r.assignment, consentConfig: r.consentConfig, consent: r.consent, test: r.isTest,
    revision: r.revision, checkpoint: r.checkpoint, prediction: r.prediction, predictionReceipt: r.predictionReceipt, createdAt: r.createdAt, updatedAt: r.updatedAt });
const exportView = (r) => ({ schema: 'political-mirror-research-export/1', collector: WORKER_VERSION, exportedAt: now(), ...responseView(r), simulated: r.isTest, removedAt: r.removedAt, journalHeadSha256: r.lastEventSha256, journalSequence: r.revision });
async function readBody(request) {
    assert(/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''), 'JSON_CONTENT_TYPE_REQUIRED', 415);
    assert(Number(request.headers.get('content-length') || 0) <= MAX_BODY_BYTES, 'BODY_TOO_LARGE', 413);
    const raw = await request.text();
    assert(raw.length <= MAX_BODY_BYTES, 'BODY_TOO_LARGE', 413);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw failure(400, 'INVALID_JSON');
    }
    assert(plain(parsed), 'OBJECT_REQUIRED', 400);
    safeJSON(parsed);
    return parsed;
}
async function loadSession(env, id) {
    assert(/^[a-f0-9-]{36}$/.test(id || ''), 'SESSION_NOT_FOUND', 404);
    const row = await env.DB.prepare('SELECT * FROM sessions WHERE session_id = ?').bind(id).first();
    return row ? rowToRecord(row) : null;
}
function authenticate(request, record, { allowRemoved = false } = {}) {
    const supplied = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') || '');
    const attempted = SHA(supplied?.[1] || '');
    assert(supplied && record && (0, sha256_mjs_1.timingSafeEqualString)(record.tokenHash, attempted), 'INVALID_SESSION_CREDENTIALS', 401);
    assert(allowRemoved || !record.removedAt, 'SESSION_REMOVED', 410);
}
function validateIdentity(state, r) {
    assert(state.sessionId === r.sessionId && state.participantId === r.sessionId, 'SESSION_ID_MISMATCH');
    assert(state.studyVersion === study_mjs_1.STUDY_VERSION, 'STUDY_VERSION_MISMATCH');
    assert((0, consent_validator_mjs_1.consentRecordIsComplete)(state.consent) && state.consent.version === study_mjs_1.CONSENT_VERSION, 'CONSENT_INCOMPLETE');
    assert(equal(state.consent, r.consent), 'CONSENT_RECORD_MISMATCH');
    assert(state.coreGame?.buildHash === build_info_json_1.default.buildHash && state.coreGame?.sourceManifestHash === build_info_json_1.default.sourceManifestHash, 'FROZEN_BUILD_MISMATCH');
    assert(equal(state.assignment, r.assignment), 'ASSIGNMENT_MISMATCH');
    try {
        (0, study_mjs_1.validateStudyState)(state, { predictionCommitted: !!r.prediction });
    }
    catch (e) {
        throw failure(422, 'INVALID_STUDY_STATE: ' + String(e.message).slice(0, 180));
    }
}
function validateEvolution(old, next, r) {
    try {
        (0, study_mjs_1.validateStudyTransition)(old, next, { predictionCommitted: !!r.prediction });
    }
    catch (e) {
        throw failure(422, 'INVALID_TRANSITION: ' + String(e.message).slice(0, 180));
    }
    assert((next.responses?.T1?.length || 0) === 0 || r.prediction, 'T1_BEFORE_PREDICTION_COMMIT', 409);
    if (next.prediction != null)
        assert(r.prediction && equal(next.prediction, r.prediction), 'PREDICTION_MISMATCH', 409);
    if (next.predictionReceipt != null)
        assert(equal(next.predictionReceipt, r.predictionReceipt), 'PREDICTION_RECEIPT_MISMATCH', 409);
    if (study_mjs_1.STAGES.indexOf(next.stage) >= study_mjs_1.STAGES.indexOf('T1') && next.stage !== 'WITHDRAWN')
        assert(r.prediction && equal(next.prediction, r.prediction) && equal(next.predictionReceipt, r.predictionReceipt), 'UNCOMMITTED_T1_STAGE', 409);
    if (next.presentation?.block === 'T1')
        assert(r.prediction, 'T1_PRESENTATION_BEFORE_COMMIT', 409);
    if (!old) {
        assert(next.stage === 'T0' && next.responses.T0.length === 0 && (next.events || []).length <= 2, 'INITIAL_STATE_MUST_BE_CONSENTED_T0');
        return;
    }
    for (const k of ['schema', 'studyVersion', 'coreGame', 'consentVersion', 'participantId', 'sessionId', 'assignment', 'consent'])
        assert(equal(old[k], next[k]), `${k.toUpperCase()}_IMMUTABLE`);
    for (const block of ['T0', 'T1', 'T2'])
        prefix(old.responses[block], next.responses[block], block + '_RESPONSES');
    prefix(old.events || [], next.events || [], 'EVENTS');
    prefix(old.technicalErrors || [], next.technicalErrors || [], 'TECHNICAL_ERRORS');
    assert(old.timestamps.createdAt === next.timestamps.createdAt, 'CREATION_TIME_IMMUTABLE');
    const before = study_mjs_1.STAGES.indexOf(old.stage), after = study_mjs_1.STAGES.indexOf(next.stage);
    assert(next.stage === 'WITHDRAWN' || (before >= 0 && after >= before && after <= before + 1), 'INVALID_STAGE_TRANSITION');
    if (['COMPLETE', 'WITHDRAWN'].includes(old.stage))
        assert(equal(old, next), 'TERMINAL_STATE_IMMUTABLE');
    if (old.game) {
        assert(next.game, 'GAME_REMOVED');
        for (const k of ['schema', 'sessionId', 'arm', 'spec'])
            assert(equal(old.game[k], next.game[k]), 'GAME_IDENTITY_IMMUTABLE');
        if (Array.isArray(old.game.transcript))
            prefix(old.game.transcript, next.game.transcript, 'GAME_TRANSCRIPT');
        if (before >= study_mjs_1.STAGES.indexOf('PREDICTION'))
            for (const k of ['canonicalState', 'canonicalHash', 'transcript', 'mirror'])
                assert(equal(old.game[k], next.game[k]), 'COMPLETED_GAME_IMMUTABLE');
    }
}
function eventStatement(env, r, sequence, type, requestId, at, record, summary) {
    const recordSha = SHA(record);
    return { recordSha, statement: env.DB.prepare('INSERT INTO session_events (session_id, sequence, type, request_id, at, revision, stage, record_sha256, previous_sha256, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(r.sessionId, sequence, type, requestId, at, sequence, record.checkpoint?.stage ?? r.stage ?? null, recordSha, r.lastEventSha256 ?? null, JSON.stringify(summary)) };
}
async function replayOrThrow(env, r, requestId, kind, input) {
    const seen = await env.DB.prepare('SELECT digest, result_json FROM session_requests WHERE session_id = ? AND request_id = ?').bind(r.sessionId, requestId).first();
    if (!seen)
        return null;
    assert(seen.digest === SHA({ kind, input }), 'REQUEST_ID_REUSED_WITH_DIFFERENT_BODY', 409);
    return JSON.parse(seen.result_json);
}
// Participant-requested withdrawal: only that session's bearer credential may erase it.
// The note stores minimal debrief metadata, never answers, gameplay, or predictions.
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
        }
        catch (_) {
            throw failure(503, 'WITHDRAWAL_NOT_CONFIRMED');
        }
    }
    const row = await env.DB.prepare('SELECT session_id,slot,is_test,study_version,revision,removed_at,removal_note FROM sessions WHERE session_id=?').bind(r.sessionId).first();
    assert(row?.removed_at, 'WITHDRAWAL_NOT_CONFIRMED', 503);
    let note = {};
    try {
        note = JSON.parse(row.removal_note || '{}');
    }
    catch { /* manual removal has no individualized debrief note */ }
    const sawFeedback = note.sawFeedback === 1;
    return { schema: 'pm-withdrawal-receipt/1', sessionId: row.session_id,
        participantCode: (row.is_test ? 'TEST' : 'P') + String(row.is_test ? row.slot - 1000000 + 1 : row.slot + 1).padStart(3, '0'),
        studyVersion: row.study_version, revision: row.revision, removedAt: row.removed_at,
        dataDeleted: true, status: 'withdrawn', sawFeedback,
        feedbackArm: sawFeedback && ['TRUE', 'SHUFFLED'].includes(note.feedbackArm) ? note.feedbackArm : null };
}
// ---------- enrollment = consent + allocation (atomic) ----------
async function handleEnroll(env, s, run, cfg, request) {
    const input = await readBody(request);
    assert(Object.keys(input).every((k) => ['requestId', 'consent', 'collectionMode'].includes(k)), 'UNKNOWN_ENROLLMENT_FIELD');
    assert(typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(input.requestId), 'INVALID_ENROLLMENT_KEY', 400);
    const enrollmentHash = SHA(input.requestId);
    const existing = await env.DB.prepare('SELECT * FROM sessions WHERE enrollment_hash = ?').bind(enrollmentHash).first();
    if (existing) {
        const r = rowToRecord(existing);
        assert(!r.removedAt, 'SESSION_REMOVED', 410);
        return json(200, { ...responseView(r), token: (0, assignment_mjs_1.enrollmentToken)(s.runKey, r.sessionId, input.requestId) });
    }
    let consent;
    try {
        consent = (0, consent_validator_mjs_1.validateConsentSubmission)(input.consent, { researcherConfigSha256: cfg.sha256, consentTextSha256: cfg.consentTextSha256 });
    }
    catch (e) {
        throw failure(e.message === 'CONSENT_CONFIG_MISMATCH' ? 409 : 422, e.message);
    }
    assert(input.collectionMode === cfg.mode && ['TEST', 'HUMAN'].includes(input.collectionMode), 'COLLECTION_MODE_CHANGED', 409);
    assert(cfg.blockers.length === 0 && cfg.configured, 'ENROLLMENT_BLOCKED: ' + cfg.blockers.join(','), 403);
    const isTest = cfg.mode === 'TEST'; // Never taken from a query parameter or user-selected flag.
    if (!isTest) {
        const rec = await recruitmentState(env, run, cfg);
        assert(rec.blockers.length === 0, 'ENROLLMENT_BLOCKED: ' + rec.blockers.join(','), 403);
        assert(rec.researcherOpened, 'RECRUITMENT_CLOSED', 403);
        assert(rec.allocated < rec.target, 'NEW_ENROLLMENT_CLOSED', 403);
    }
    const table = isTest ? 'test_slot_reservations' : 'slot_reservations';
    const cap = isTest ? 100000 : cfg.config.recruitment.targetAllocations;
    // Candidate slots are optimistic. The UNIQUE insert and every dependent write are in ONE
    // D1 batch transaction. A losing contender retries from the database; a failed transaction
    // consumes no slot. SQL triggers recheck active consent/config, recruitment and quota at commit.
    for (let attempt = 0; attempt < 32; attempt++) {
        const counts = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(slot), -1) + 1 AS next_slot FROM ${table}`).first();
        assert(counts.n === counts.next_slot, 'ALLOCATION_INTEGRITY_ERROR: run the read-only integrity check', 503);
        if (counts.n >= cap) {
            // Another in-flight copy of this same enrollment may just have claimed the final slot.
            const existingAtCap = await env.DB.prepare('SELECT * FROM sessions WHERE enrollment_hash = ?').bind(enrollmentHash).first();
            if (existingAtCap) {
                const r = rowToRecord(existingAtCap);
                assert(!r.removedAt, 'SESSION_REMOVED', 410);
                return json(200, { ...responseView(r), token: (0, assignment_mjs_1.enrollmentToken)(s.runKey, r.sessionId, input.requestId) });
            }
            throw failure(403, 'NEW_ENROLLMENT_CLOSED');
        }
        const slot = counts.next_slot, sessionId = crypto.randomUUID(), at = now();
        const assignment = (0, assignment_mjs_1.assignmentForSlot)(slot, isTest ? s.runKey + '|TEST-SESSIONS' : s.runKey, run.run_id);
        if (isTest)
            assignment.test = true;
        const token = (0, assignment_mjs_1.enrollmentToken)(s.runKey, sessionId, input.requestId);
        const consentRecord = { ...consent, at, version: study_mjs_1.CONSENT_VERSION };
        const consentConfig = { consentVersion: study_mjs_1.CONSENT_VERSION, consentTemplateVersion: consent_text_mjs_1.CONSENT_TEMPLATE_VERSION,
            consentTextSha256: cfg.consentTextSha256, researcherConfigSha256: cfg.sha256, studyTitle: cfg.config.studyTitle,
            ethicsArrangement: cfg.config.ethics.arrangement, ethicsReference: cfg.config.ethics.reference,
            ethicsBody: cfg.config.ethics.body, testSession: isTest };
        const record = { schema: 'pm-collected-session/1', sessionId, studyVersion: study_mjs_1.STUDY_VERSION, assignment, consentConfig,
            consent: consentRecord, test: isTest, createdAt: at, updatedAt: at, revision: 0, checkpoint: null, prediction: null, predictionReceipt: null };
        const recordSha = SHA(record);
        const statements = [
            env.DB.prepare(`INSERT INTO ${table} (slot, enrollment_hash, at) VALUES (?, ?, ?)`).bind(slot, enrollmentHash, at),
            env.DB.prepare('INSERT INTO sessions (session_id, slot, run_id, arm, form_order, assignment_json, enrollment_hash, token_hash, study_version, consent_config_json, consent_json, is_test, revision, stage, status, consented_at, last_event_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)')
                .bind(sessionId, isTest ? 1000000 + slot : slot, run.run_id, assignment.arm, assignment.formOrder.join(''), JSON.stringify(assignment), enrollmentHash, SHA(token), study_mjs_1.STUDY_VERSION, JSON.stringify(consentConfig), JSON.stringify(consentRecord), isTest ? 1 : 0, 'consented_no_checkpoint', at, recordSha, at, at),
            env.DB.prepare('INSERT INTO consent_records (session_id, consent_version, consent_text_sha256, researcher_config_sha256, consent_json, consented_at, recorded_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
                .bind(sessionId, study_mjs_1.CONSENT_VERSION, cfg.consentTextSha256, cfg.sha256, JSON.stringify(consentRecord), at, at),
            env.DB.prepare('INSERT INTO session_events (session_id, sequence, type, request_id, at, revision, stage, record_sha256, previous_sha256, summary_json) VALUES (?, 0, ?, NULL, ?, 0, NULL, ?, NULL, ?)')
                .bind(sessionId, 'session-created', at, recordSha, JSON.stringify({ slot, arm: assignment.arm, formOrder: assignment.formOrder, test: isTest, consentTextSha256: cfg.consentTextSha256 })),
        ];
        if (!isTest)
            statements.push(env.DB.prepare('UPDATE study_run SET config_locked_at = COALESCE(config_locked_at, ?) WHERE id = 1').bind(at));
        try {
            await env.DB.batch(statements);
        }
        catch (e) {
            const guard = sqlGuardFailure(e);
            if (guard)
                throw guard;
            // A duplicate key must recover the committed participant, never a reservation alone.
            const dup = await env.DB.prepare('SELECT * FROM sessions WHERE enrollment_hash = ?').bind(enrollmentHash).first();
            if (dup) {
                const r = rowToRecord(dup);
                assert(!r.removedAt, 'SESSION_REMOVED', 410);
                return json(200, { ...responseView(r), token: (0, assignment_mjs_1.enrollmentToken)(s.runKey, r.sessionId, input.requestId) });
            }
            if (isConstraint(e) && /slot_reservations|sessions\.slot/.test(sqlErrorText(e)))
                continue;
            throw failure(503, 'D1_WRITE_FAILED');
        }
        return json(201, { sessionId, studyVersion: study_mjs_1.STUDY_VERSION, assignment, consentConfig, consent: consentRecord, test: isTest,
            revision: 0, checkpoint: null, prediction: null, predictionReceipt: null, createdAt: at, updatedAt: at, token });
    }
    throw failure(503, 'ENROLLMENT_BUSY_RETRY_SAME_KEY');
}
// ---------- checkpoint / prediction ----------
async function handleWrite(env, s, request, r, kind) {
    const input = await readBody(request);
    assert(typeof input.requestId === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(input.requestId), 'INVALID_REQUEST_ID', 400);
    assert(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, 'INVALID_REVISION', 400);
    assert(Object.keys(input).every((k) => ['requestId', 'expectedRevision', kind].includes(k)), 'UNKNOWN_REQUEST_FIELD', 400);
    const replay = await replayOrThrow(env, r, input.requestId, kind, input);
    if (replay)
        return json(200, replay);
    assert(input.expectedRevision === r.revision, 'REVISION_CONFLICT', 409);
    const revision = r.revision + 1, at = now(), digest = SHA({ kind, input });
    const statements = [];
    let result, nextRecord;
    if (kind === 'checkpoint') {
        assert(plain(input.checkpoint), 'CHECKPOINT_REQUIRED');
        validateIdentity(input.checkpoint, r);
        validateEvolution(r.checkpoint, input.checkpoint, r);
        const cp = input.checkpoint;
        if (cp.stage === 'WITHDRAWN')
            return json(200, await removeParticipantData(env, r));
        nextRecord = { ...responseView(r), revision, updatedAt: at, checkpoint: cp };
        result = { revision, predictionCommitted: !!r.prediction, ...(r.predictionReceipt ? { committedAt: r.predictionReceipt.committedAt, predictionSha256: r.predictionReceipt.predictionSha256, predictionReceipt: r.predictionReceipt } : {}) };
        const summary = { stage: cp.stage, status: cp.status, presentation: cp.presentation?.block ?? null, responses: { T0: cp.responses.T0.length, T1: cp.responses.T1.length, T2: cp.responses.T2.length },
            actions: cp.game?.transcript?.length ?? 0, events: cp.events.length, technicalErrors: cp.technicalErrors.length, withdrawal: cp.withdrawal ? { reason: cp.withdrawal.reason, stageAtStop: cp.withdrawal.stageAtStop, sawFeedback: cp.withdrawal.sawFeedback, dataRemovalRequested: cp.withdrawal.dataRemovalRequested } : null };
        const ev = eventStatement(env, r, revision, 'checkpoint', input.requestId, at, nextRecord, summary);
        statements.push(env.DB.prepare('UPDATE sessions SET revision = ?, checkpoint_json = ?, checkpoint_sha256 = ?, stage = ?, status = ?, technical_error_count = ?, last_event_sha256 = ?, updated_at = ? WHERE session_id = ?')
            .bind(revision, JSON.stringify(cp), SHA(cp), cp.stage, cp.status, cp.technicalErrors.length, ev.recordSha, at, r.sessionId));
        statements.push(ev.statement);
    }
    else {
        assert(plain(input.prediction), 'PREDICTION_REQUIRED');
        assert(!r.prediction, 'PREDICTION_ALREADY_COMMITTED', 409);
        assert(r.checkpoint?.stage === 'PREDICTION' && (r.checkpoint.responses?.T1?.length || 0) === 0, 'INVALID_PREDICTION_STAGE', 409);
        let rebuilt;
        try {
            rebuilt = (0, rebuild_mjs_1.rebuildCommittedPredictionWith)(r.checkpoint, input.prediction, build_info_json_1.default);
        }
        catch (e) {
            throw failure(422, 'PREDICTION_VALIDATION_FAILED: ' + String(e.message).slice(0, 180));
        }
        assert(equal(rebuilt, input.prediction), 'PREDICTION_REBUILD_MISMATCH', 409);
        const p = input.prediction, predictionSha256 = SHA(p);
        const receipt = { committedAt: at, predictionSha256, sessionId: r.sessionId, studyVersion: study_mjs_1.STUDY_VERSION, revision, collector: WORKER_VERSION };
        nextRecord = { ...responseView(r), revision, updatedAt: at, prediction: p, predictionReceipt: receipt };
        result = { revision, predictionCommitted: true, committedAt: at, predictionSha256, predictionReceipt: receipt };
        const ev = eventStatement(env, r, revision, 'prediction', input.requestId, at, nextRecord, { modelVersion: p.modelVersion, actorRuleVersion: p.actorRuleVersion, form: p.form, personalizedItems: p.modelState?.M3?.coverage?.personalizedItems ?? null });
        statements.push(env.DB.prepare('INSERT INTO prediction_commits (session_id, prediction_sha256, model_version, actor_rule_version, case_bank_version, study_version, core_hash, form, committed_at, revision, commit_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(r.sessionId, predictionSha256, p.modelVersion, p.actorRuleVersion, p.caseBankVersion, p.studyVersion, p.coreHash, p.form, at, revision, JSON.stringify(p)));
        const rows = p.predictions.map((row, i) => [r.sessionId, row.caseId, i, row.dimension, row.M0.predictedScore, row.M1.predictedScore, row.M2.predictedScore, row.M3.predictedScore, row.M3.personalized ? 1 : 0]);
        statements.push(env.DB.prepare('INSERT INTO prediction_items (session_id, case_id, position, dimension, m0, m1, m2, m3, m3_personalized) VALUES ' + rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')).bind(...rows.flat()));
        statements.push(env.DB.prepare('UPDATE sessions SET revision = ?, prediction_json = ?, prediction_receipt_json = ?, last_event_sha256 = ?, updated_at = ? WHERE session_id = ?')
            .bind(revision, JSON.stringify(p), JSON.stringify(receipt), ev.recordSha, at, r.sessionId));
        statements.push(ev.statement);
    }
    statements.push(env.DB.prepare('INSERT INTO session_requests (session_id, request_id, kind, digest, result_json, at) VALUES (?, ?, ?, ?, ?, ?)').bind(r.sessionId, input.requestId, kind, digest, JSON.stringify(result), at));
    let results;
    try {
        results = await env.DB.batch(statements);
    }
    catch (e) {
        const current = await loadSession(env, r.sessionId);
        assert(current && !current.removedAt, 'SESSION_REMOVED', 410);
        const guard = sqlGuardFailure(e);
        if (guard && guard.code !== 'REVISION_CONFLICT')
            throw guard;
        if (!isConstraint(e))
            throw failure(503, 'D1_WRITE_FAILED');
        const replayed = await replayOrThrow(env, r, input.requestId, kind, input);
        if (replayed)
            return json(200, replayed);
        throw failure(409, kind === 'prediction' && /prediction_commits/.test(String(e.message)) ? 'PREDICTION_ALREADY_COMMITTED' : 'REVISION_CONFLICT');
    }
    assert(results[kind === 'checkpoint' ? 0 : 2]?.meta?.changes === 1, 'D1_UPDATE_DID_NOT_APPLY', 503);
    return json(200, result);
}
exports.default = {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/researcher.html' || url.pathname === '/api/researcher' || url.pathname.startsWith('/api/researcher/') || url.pathname.startsWith('/api/admin/'))
            return json(404, { error: 'NOT_FOUND' });
        if (!url.pathname.startsWith('/api/'))
            return env.ASSETS.fetch(request);
        try {
            assert(env.DB, 'D1_BINDING_DB_MISSING', 503);
            assert(request.headers.get('sec-fetch-site') !== 'cross-site', 'CROSS_ORIGIN_REQUEST', 403);
            const origin = request.headers.get('origin');
            if (origin) {
                let o;
                try {
                    o = new URL(origin);
                }
                catch {
                    throw failure(403, 'INVALID_ORIGIN');
                }
                assert(o.host === url.host, 'CROSS_ORIGIN_REQUEST', 403);
            }
            // Bootstrap uses only the authenticated deployment's own static configuration.
            // Request bodies/query parameters never supply schema, study config or mode.
            const schema = await (0, auto_storage_mjs_1.ensureStorage)(env, request.url);
            assert(schema.version === SCHEMA_VERSION, 'INCOMPATIBLE_DATABASE', 503);
            const s = await secrets(env);
            const run = await ensureRun(env, s);
            const cfg = await activeConfig(env, run);
            if (url.pathname === '/api/health' && request.method === 'GET') {
                const rec = await recruitmentState(env, run, cfg);
                return json(200, { ok: true, releaseVersion: RELEASE_VERSION, collector: WORKER_VERSION, studyVersion: study_mjs_1.STUDY_VERSION, schemaVersion: schema.version, runId: run.run_id, configured: cfg.configured, recruitmentOpen: rec.open, blockers: rec.blockers, management: 'cloudflare-account-only', manualSecretsRequired: false, manualSQLRequired: false, recordsTable: 'participants', automaticDatabaseSetup: true, mode: cfg.mode, testOpen: rec.testOpen });
            }
            if (url.pathname === '/api/config' && request.method === 'GET') {
                const rec = await recruitmentState(env, run, cfg), c = cfg.config;
                return json(200, { studyVersion: study_mjs_1.STUDY_VERSION, collector: WORKER_VERSION, collectionMode: cfg.mode, storage: 'cloudflare-pages-d1', predictionCommitRequired: true, maxBodyBytes: MAX_BODY_BYTES, serverTime: now(),
                    configured: cfg.configured, allowedNewEnroll: rec.open || rec.testOpen, maxParticipants: rec.target, enrollmentBlockers: rec.blockers, runId: run.run_id,
                    researcher: { studyTitle: c.studyTitle, principalInvestigator: c.principalInvestigator, institution: c.institution, contactEmail: c.contactEmail, estimatedDurationMinutes: c.estimatedDurationMinutes,
                        durationEstimateBasis: c.durationEstimateBasis, dataRetention: c.dataRetention, dataAccess: c.dataAccess, withdrawalProcedure: c.withdrawalProcedure, ethics: c.ethics, sha256: cfg.sha256 },
                    consentDocument: cfg.document, consentTextSha256: cfg.consentTextSha256, consentTemplateVersion: consent_text_mjs_1.CONSENT_TEMPLATE_VERSION, contactEmail: c.contactEmail, consentVersion: study_mjs_1.CONSENT_VERSION });
            }
            if (url.pathname === '/api/session' && request.method === 'POST')
                return await handleEnroll(env, s, run, cfg, request);
            const match = /^\/api\/session\/([^/]+)(?:\/(checkpoint|prediction|export|withdraw))?$/.exec(url.pathname);
            assert(match, 'NOT_FOUND', 404);
            const record = await loadSession(env, match[1]);
            authenticate(request, record, { allowRemoved: match[2] === 'withdraw' });
            if (match[2] === 'withdraw') {
                assert(request.method === 'POST', 'METHOD_NOT_ALLOWED', 405);
                const body = await readBody(request);
                assert(Object.keys(body).every(k => k === 'requestId') && typeof body.requestId === 'string'
                    && /^[A-Za-z0-9_-]{20,128}$/.test(body.requestId), 'INVALID_WITHDRAWAL_REQUEST', 422);
                return json(200, await removeParticipantData(env, record));
            }
            if (request.method === 'GET' && !match[2])
                return json(200, responseView(record));
            if (request.method === 'GET' && match[2] === 'export')
                return json(200, exportView(record));
            assert(request.method === 'POST' && ['checkpoint', 'prediction'].includes(match[2]), 'METHOD_NOT_ALLOWED', 405);
            return await handleWrite(env, s, request, record, match[2]);
        }
        catch (e) {
            const status = e.status || 500;
            if (status >= 500)
                console.error(`[pm-collector] ${status} ${url.pathname}: ${String(e && e.message).slice(0, 300)}`);
            return json(status, { error: e.code || (e.status ? 'INVALID_REQUEST' : 'INTERNAL_ERROR') });
        }
    },
};

}],
"pilot/build-info.json": [{}, function(module, exports, require) {
module.exports = JSON.parse("{\n  \"version\": \"0.37.2\",\n  \"buildHash\": \"f5eaaff91d5ccc9b03bb7fbc240cd4b5ed592e0a37448a15b537024a2c8f5e04\",\n  \"sourceManifestHash\": \"439b4dc3ac6cd7b884976530230e99f088b7d82e9998e299b04c8db49be88934\",\n  \"studyVersion\": \"0.38.3-pilot.1\"\n}\n");
}],
"pilot-cloud/auto-storage.mjs": [{"./schema-statements.json":"pilot-cloud/schema-statements.json","../pilot/researcher-config.mjs":"pilot/researcher-config.mjs","../pilot/consent-text.mjs":"pilot/consent-text.mjs","../pilot/assignment.mjs":"pilot/assignment.mjs","../pilot/sha256.mjs":"pilot/sha256.mjs"}, function(module, exports, require) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORAGE_SCHEMA = void 0;
exports.ensureStorage = ensureStorage;
// Cloudflare is the storage backend only. No public management/init/config route.
// Database initialization and config come from this deployment's own assets, not clients.
const schema_statements_json_1 = __importDefault(require("./schema-statements.json"));
const researcher_config_mjs_1 = require("../pilot/researcher-config.mjs");
const consent_text_mjs_1 = require("../pilot/consent-text.mjs");
const assignment_mjs_1 = require("../pilot/assignment.mjs");
const sha256_mjs_1 = require("../pilot/sha256.mjs");
exports.STORAGE_SCHEMA = 6;
const PRODUCT = 'political-mirror-autostorage';
function fail(code, status = 503) { const e = new Error(code); e.code = code; e.status = status; throw e; }
function check(ok, code, status) { if (!ok)
    fail(code, status); }
function message(e) { return [e, e?.cause, e?.cause?.cause].filter(Boolean).map(x => String(x.message || x)).join(' | '); }
async function readDeployment(env, url) {
    // ASSETS is a provider binding. This never follows a caller-supplied fetch URL.
    const assetURL = new URL('/study-deployment.json', url);
    const response = await env.ASSETS.fetch(new Request(assetURL, { method: 'GET' }));
    check(response.ok, 'DEPLOYMENT_SETTINGS_FILE_MISSING');
    const text = await response.text();
    check(text.length < 100000, 'DEPLOYMENT_SETTINGS_TOO_LARGE');
    let m;
    try {
        m = JSON.parse(text);
    }
    catch {
        fail('DEPLOYMENT_SETTINGS_INVALID_JSON');
    }
    check(m && m.schema === 'pm-autostorage-deployment/1', 'DEPLOYMENT_SETTINGS_WRONG_FORMAT');
    check(m.releaseVersion === '0.38.3-storage.2', 'DEPLOYMENT_RELEASE_MISMATCH');
    check(Number.isSafeInteger(m.revision) && m.revision > 0, 'DEPLOYMENT_REVISION_INVALID');
    check(['TEST', 'HUMAN', 'CLOSED'].includes(m.mode), 'DEPLOYMENT_MODE_INVALID');
    const loaded = m.researcherConfig == null ? null : (0, researcher_config_mjs_1.loadResearcherConfig)(m.researcherConfig);
    if (loaded)
        check(loaded.blockers.length === 0, 'RESEARCHER_INFORMATION_INCOMPLETE: ' + loaded.blockers.join(', '));
    else
        check(m.mode === 'CLOSED', 'RESEARCHER_INFORMATION_REQUIRED_BEFORE_ENROLLMENT');
    const removals = m.removeSessionIds ?? [];
    check(Array.isArray(removals) && removals.length <= 20 && removals.every(x => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x)), 'INVALID_REMOVAL_SESSION_IDS');
    check(removals.length === 0 || m.mode === 'CLOSED', 'CLOSE_RECRUITMENT_FOR_DEPLOYMENT_REMOVAL');
    const document = loaded ? (0, consent_text_mjs_1.buildConsentDocument)(loaded.config) : null;
    const content = { schema: m.schema, releaseVersion: m.releaseVersion, revision: m.revision, mode: m.mode, researcherConfig: loaded?.config ?? null, removeSessionIds: [...new Set(removals)].sort() };
    return { revision: m.revision, mode: m.mode, loaded, document, removals: content.removeSessionIds, digest: (0, sha256_mjs_1.sha256Hex)((0, assignment_mjs_1.stableJSON)(content)) };
}
async function inspectSchema(db) {
    const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").first();
    if (!table)
        return null;
    const version = await db.prepare('SELECT version FROM schema_version WHERE id=1').first();
    check(version?.version === exports.STORAGE_SCHEMA, 'USE_A_NEW_DEDICATED_DATABASE: existing schema is not auto-storage version 6');
    const marker = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_installation'").first();
    check(marker, 'DATABASE_OWNERSHIP_MARKER_MISSING');
    const identity = await db.prepare('SELECT product,schema_version FROM storage_installation WHERE id=1').first();
    check(identity?.product === PRODUCT && identity.schema_version === exports.STORAGE_SCHEMA, 'DATABASE_OWNERSHIP_MISMATCH');
    return version;
}
async function initialize(db) {
    let found = await inspectSchema(db);
    if (found)
        return found;
    const others = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'").all();
    if (others.results.length) {
        // A concurrent initializer may have committed between the preceding reads.
        found = await inspectSchema(db);
        if (found)
            return found;
        fail('DATABASE_NOT_EMPTY: create a new dedicated D1; existing data was not changed');
    }
    // IF NOT EXISTS plus INSERT OR IGNORE makes same-build concurrent bootstrap harmless.
    // All DDL and the completion marker are in ONE D1 transaction; no partial schema commit.
    try {
        await db.batch(schema_statements_json_1.default.map(sql => db.prepare(sql)));
    }
    catch (e) {
        fail('AUTOMATIC_DATABASE_SETUP_FAILED: ' + message(e).slice(0, 170));
    }
    return await inspectSchema(db);
}
async function applyDeployment(db, m) {
    let state = await db.prepare('SELECT revision,manifest_sha256 FROM deployment_state WHERE id=1').first();
    check(state, 'DEPLOYMENT_STATE_MISSING');
    if (state.revision > m.revision)
        fail('OLD_DEPLOYMENT: open the current production URL; no data was changed', 409);
    if (state.revision === m.revision) {
        check(state.manifest_sha256 === m.digest, 'SAME_REVISION_DIFFERENT_SETTINGS', 409);
        return;
    }
    const at = new Date().toISOString();
    try {
        // The UPDATE and its settings/snapshot/lock triggers commit atomically. The WHERE
        // prevents an older in-flight deployment from overwriting a later activation.
        await db.prepare(`UPDATE deployment_state SET revision=?,manifest_sha256=?,config_sha256=?,
   consent_text_sha256=?,researcher_config_json=?,consent_document_json=?,mode=?,updated_at=?,removal_ids_json=?
   WHERE id=1 AND revision<?`).bind(m.revision, m.digest, m.loaded?.sha256 ?? null, m.loaded ? (0, consent_text_mjs_1.consentDocumentSha256)(m.loaded.config) : null, m.loaded ? JSON.stringify(m.loaded.config) : null, m.document ? JSON.stringify(m.document) : null, m.mode, at, JSON.stringify(m.removals), m.revision).run();
    }
    catch (e) {
        if (/CONFIG_LOCKED_AFTER_FIRST_CONSENT/.test(message(e)))
            fail('STUDY_INFORMATION_LOCKED: use the original saved study details', 409);
        if (/CANNOT_REOPEN_TEST_MODE/.test(message(e)))
            fail('CANNOT_CHANGE_HUMAN_STUDY_BACK_TO_TEST', 409);
        throw e;
    }
    state = await db.prepare('SELECT revision,manifest_sha256 FROM deployment_state WHERE id=1').first();
    check(state?.revision === m.revision && state?.manifest_sha256 === m.digest, 'DEPLOYMENT_CHANGED_RETRY_CURRENT_URL', 409);
}
async function ensureStorage(env, url) {
    const deployment = await readDeployment(env, url); // validate before any DDL/data change
    const schema = await initialize(env.DB);
    await applyDeployment(env.DB, deployment);
    return schema;
}

}],
"pilot-cloud/schema-statements.json": [{}, function(module, exports, require) {
module.exports = JSON.parse("[\n  \"-- Maintainer reference: automatically initialized by the Worker. Not a user setup step.\\n-- Political Mirror 0.38.2-cx.1 / schema 4. Use a NEW dedicated D1, not C15x or a live older PM database.\\n-- No manual Secrets. Configure using the supplied offline settings page.\\nCREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, applied_at TEXT NOT NULL);\",\n  \"CREATE TABLE IF NOT EXISTS study_run (\\n  id INTEGER PRIMARY KEY CHECK (id = 1),\\n  run_id TEXT NOT NULL,\\n  run_key_sha256 TEXT NOT NULL,\\n  study_version TEXT NOT NULL,\\n  active_config_sha256 TEXT,            -- researcher configuration currently shown to new participants (NULL = not configured)\\n  recruitment_open INTEGER NOT NULL DEFAULT 0,  -- 0 by default: the researcher opens recruitment explicitly\\n  config_locked_at TEXT,                -- set when the first human participant consents; configuration is frozen afterwards\\n  created_at TEXT NOT NULL\\n);\",\n  \"-- Append-only: every configuration ever shown to a participant stays retrievable by hash.\\nCREATE TABLE IF NOT EXISTS config_snapshots (\\n  researcher_config_sha256 TEXT PRIMARY KEY,\\n  consent_template_version TEXT NOT NULL,\\n  consent_text_sha256 TEXT NOT NULL,\\n  researcher_config_json TEXT NOT NULL,\\n  consent_document_json TEXT NOT NULL,\\n  study_version TEXT NOT NULL,\\n  first_seen_at TEXT NOT NULL,\\n  saved_by TEXT NOT NULL DEFAULT 'researcher'\\n);\",\n  \"-- Test (QA) sessions are numbered separately and never count toward the human quota.\\nCREATE TABLE IF NOT EXISTS test_slot_reservations (\\n  slot INTEGER PRIMARY KEY,\\n  enrollment_hash TEXT NOT NULL UNIQUE,\\n  at TEXT NOT NULL\\n);\",\n  \"-- Race-free slot allocation: the slot number is computed inside the INSERT statement itself\\n-- (single SQLite writer, one implicit transaction), so concurrent enrollments never read a\\n-- stale count. Reservation AND session/consent now commit in one batch. Reservations are keyed by the client's enrollment key so a retry after a lost\\n-- response reuses its reservation instead of burning a slot. Rows are never deleted.\\nCREATE TABLE IF NOT EXISTS slot_reservations (\\n  slot INTEGER PRIMARY KEY,\\n  enrollment_hash TEXT NOT NULL UNIQUE,\\n  at TEXT NOT NULL\\n);\",\n  \"CREATE TABLE IF NOT EXISTS sessions (\\n  session_id TEXT PRIMARY KEY,\\n  slot INTEGER NOT NULL UNIQUE,\\n  run_id TEXT NOT NULL,\\n  arm TEXT NOT NULL CHECK (arm IN ('TRUE','SHUFFLED')),\\n  form_order TEXT NOT NULL,\\n  assignment_json TEXT NOT NULL,\\n  enrollment_hash TEXT NOT NULL UNIQUE,\\n  token_hash TEXT NOT NULL,\\n  study_version TEXT NOT NULL,\\n  consent_config_json TEXT NOT NULL,\\n  consent_json TEXT,                    -- the consent record accepted at enrollment (server time)\\n  is_test INTEGER NOT NULL DEFAULT 0,   -- 1 = researcher-issued test session (server-controlled, excluded from analysis)\\n  removed_at TEXT,                      -- data removal executed by the researcher (tombstone keeps the slot consumed)\\n  removal_note TEXT,\\n  revision INTEGER NOT NULL DEFAULT 0,\\n  stage TEXT,\\n  status TEXT,\\n  consented_at TEXT,\\n  checkpoint_json TEXT,\\n  checkpoint_sha256 TEXT,\\n  prediction_json TEXT,\\n  prediction_receipt_json TEXT,\\n  last_event_sha256 TEXT,\\n  technical_error_count INTEGER NOT NULL DEFAULT 0,\\n  created_at TEXT NOT NULL,\\n  updated_at TEXT NOT NULL\\n);\",\n  \"CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions (status, stage);\",\n  \"-- Revision chain: a stale write must fail as a SQL error so that D1 batch() rolls back the\\n-- whole write atomically (a conditional UPDATE that touches 0 rows would not fail by itself).\\nCREATE TRIGGER IF NOT EXISTS sessions_revision_chain BEFORE UPDATE OF revision ON sessions\\nWHEN NEW.revision != OLD.revision + 1\\nBEGIN SELECT RAISE(ABORT, 'REVISION_CONFLICT'); END;\",\n  \"CREATE TABLE IF NOT EXISTS session_events (\\n  session_id TEXT NOT NULL REFERENCES sessions (session_id),\\n  sequence INTEGER NOT NULL,\\n  type TEXT NOT NULL,\\n  request_id TEXT,\\n  at TEXT NOT NULL,\\n  revision INTEGER NOT NULL,\\n  stage TEXT,\\n  record_sha256 TEXT NOT NULL,\\n  previous_sha256 TEXT,\\n  summary_json TEXT NOT NULL,\\n  PRIMARY KEY (session_id, sequence)\\n);\",\n  \"CREATE TABLE IF NOT EXISTS session_requests (\\n  session_id TEXT NOT NULL REFERENCES sessions (session_id),\\n  request_id TEXT NOT NULL,\\n  kind TEXT NOT NULL,\\n  digest TEXT NOT NULL,\\n  result_json TEXT NOT NULL,\\n  at TEXT NOT NULL,\\n  PRIMARY KEY (session_id, request_id)\\n);\",\n  \"CREATE TABLE IF NOT EXISTS consent_records (\\n  session_id TEXT PRIMARY KEY REFERENCES sessions (session_id),\\n  consent_version TEXT NOT NULL,\\n  consent_text_sha256 TEXT NOT NULL,\\n  researcher_config_sha256 TEXT NOT NULL,\\n  consent_json TEXT NOT NULL,\\n  consented_at TEXT NOT NULL,\\n  recorded_at TEXT NOT NULL,\\n  revision INTEGER NOT NULL\\n);\",\n  \"CREATE TABLE IF NOT EXISTS prediction_commits (\\n  session_id TEXT PRIMARY KEY REFERENCES sessions (session_id),\\n  prediction_sha256 TEXT NOT NULL,\\n  model_version TEXT NOT NULL,\\n  actor_rule_version TEXT NOT NULL,\\n  case_bank_version TEXT NOT NULL,\\n  study_version TEXT NOT NULL,\\n  core_hash TEXT NOT NULL,\\n  form TEXT NOT NULL,\\n  committed_at TEXT NOT NULL,\\n  revision INTEGER NOT NULL,\\n  commit_json TEXT NOT NULL\\n);\",\n  \"CREATE TABLE IF NOT EXISTS prediction_items (\\n  session_id TEXT NOT NULL REFERENCES sessions (session_id),\\n  case_id TEXT NOT NULL,\\n  position INTEGER NOT NULL,\\n  dimension TEXT NOT NULL,\\n  m0 REAL NOT NULL, m1 REAL NOT NULL, m2 REAL NOT NULL, m3 REAL NOT NULL,\\n  m3_personalized INTEGER NOT NULL,\\n  PRIMARY KEY (session_id, case_id)\\n);\",\n  \"CREATE TABLE IF NOT EXISTS researcher_audit (\\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\\n  at TEXT NOT NULL,\\n  action TEXT NOT NULL,\\n  detail TEXT\\n);\",\n  \"-- v3 commit-time invariants. These guards execute INSIDE D1 batch() transactions.\\n-- A failed guard raises a SQL error (not an UPDATE of zero rows), rolling back the WHOLE batch.\\nCREATE TRIGGER IF NOT EXISTS run_config_locked_guard\\nBEFORE UPDATE OF active_config_sha256 ON study_run\\nWHEN OLD.config_locked_at IS NOT NULL AND NEW.active_config_sha256 IS NOT OLD.active_config_sha256\\nBEGIN SELECT RAISE(ABORT, 'CONFIG_LOCKED_AFTER_FIRST_CONSENT'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS run_lock_permanent_guard\\nBEFORE UPDATE OF config_locked_at ON study_run\\nWHEN OLD.config_locked_at IS NOT NULL AND NEW.config_locked_at IS NOT OLD.config_locked_at\\nBEGIN SELECT RAISE(ABORT, 'CONFIG_LOCKED_AFTER_FIRST_CONSENT'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS run_open_boolean_guard\\nBEFORE UPDATE OF recruitment_open ON study_run\\nWHEN NEW.recruitment_open IS NULL OR NEW.recruitment_open NOT IN (0, 1)\\nBEGIN SELECT RAISE(ABORT, 'CONFIG_CHANGED_RELOAD_REQUIRED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS sessions_enrollment_commit_guard\\nBEFORE INSERT ON sessions\\nBEGIN\\n  SELECT CASE WHEN NOT EXISTS (\\n    SELECT 1 FROM study_run r JOIN config_snapshots c\\n      ON c.researcher_config_sha256 = r.active_config_sha256\\n    WHERE r.id = 1 AND r.run_id = NEW.run_id AND r.study_version = NEW.study_version\\n      AND r.active_config_sha256 = json_extract(NEW.consent_config_json, '$.researcherConfigSha256')\\n      AND c.consent_text_sha256 = json_extract(NEW.consent_config_json, '$.consentTextSha256')\\n      AND c.consent_text_sha256 = json_extract(NEW.consent_json, '$.consentTextSha256')\\n      AND c.researcher_config_sha256 = json_extract(NEW.consent_json, '$.researcherConfigSha256')\\n  ) THEN RAISE(ABORT, 'CONSENT_CONFIG_MISMATCH') END;\\n  SELECT CASE WHEN NEW.is_test = 0 AND NOT EXISTS (\\n    SELECT 1 FROM study_run WHERE id = 1 AND recruitment_open = 1\\n  ) THEN RAISE(ABORT, 'RECRUITMENT_CLOSED') END;\\n  SELECT CASE WHEN NEW.is_test = 0 AND (SELECT COUNT(*) FROM sessions WHERE is_test = 0) >= COALESCE((\\n    SELECT json_extract(c.researcher_config_json, '$.recruitment.targetAllocations')\\n    FROM study_run r JOIN config_snapshots c ON c.researcher_config_sha256 = r.active_config_sha256 WHERE r.id = 1\\n  ), 0) THEN RAISE(ABORT, 'NEW_ENROLLMENT_CLOSED') END;\\n  SELECT CASE WHEN (NEW.is_test = 0 AND NOT EXISTS (\\n    SELECT 1 FROM slot_reservations WHERE slot = NEW.slot AND enrollment_hash = NEW.enrollment_hash\\n  )) OR (NEW.is_test = 1 AND NOT EXISTS (\\n    SELECT 1 FROM test_slot_reservations WHERE slot = NEW.slot - 1000000 AND enrollment_hash = NEW.enrollment_hash\\n  )) THEN RAISE(ABORT, 'RESERVATION_SESSION_MISMATCH') END;\\nEND;\",\n  \"-- Even an already authenticated request cannot alter a removed row. The remove operation itself\\n-- is allowed because OLD.removed_at is NULL; it increments revision and clears all content.\\nCREATE TRIGGER IF NOT EXISTS sessions_tombstone_permanent\\nBEFORE UPDATE ON sessions WHEN OLD.removed_at IS NOT NULL\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS config_snapshots_no_update\\nBEFORE UPDATE ON config_snapshots\\nBEGIN SELECT RAISE(ABORT, 'CONFIG_SNAPSHOT_IMMUTABLE'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS config_snapshots_no_delete\\nBEFORE DELETE ON config_snapshots\\nBEGIN SELECT RAISE(ABORT, 'CONFIG_SNAPSHOT_IMMUTABLE'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS session_events_live_parent_insert\\nBEFORE INSERT ON session_events\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS session_events_live_parent_update\\nBEFORE UPDATE ON session_events\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS session_requests_live_parent_insert\\nBEFORE INSERT ON session_requests\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS session_requests_live_parent_update\\nBEFORE UPDATE ON session_requests\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS consent_records_live_parent_insert\\nBEFORE INSERT ON consent_records\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS consent_records_live_parent_update\\nBEFORE UPDATE ON consent_records\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS prediction_commits_live_parent_insert\\nBEFORE INSERT ON prediction_commits\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS prediction_commits_live_parent_update\\nBEFORE UPDATE ON prediction_commits\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS prediction_items_live_parent_insert\\nBEFORE INSERT ON prediction_items\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS prediction_items_live_parent_update\\nBEFORE UPDATE ON prediction_items\\nWHEN NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id AND removed_at IS NULL)\\nBEGIN SELECT RAISE(ABORT, 'SESSION_REMOVED'); END;\",\n  \"-- CX-style deployment: management is performed only through the authenticated D1 Console.\\nCREATE TABLE IF NOT EXISTS private_runtime (\\n  id INTEGER PRIMARY KEY CHECK (id = 1),\\n  runtime_key TEXT NOT NULL CHECK(length(runtime_key) = 64),\\n  created_at TEXT NOT NULL\\n);\",\n  \"CREATE TRIGGER IF NOT EXISTS private_runtime_immutable_update BEFORE UPDATE ON private_runtime\\nBEGIN SELECT RAISE(ABORT, 'PRIVATE_RUNTIME_IMMUTABLE'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS private_runtime_immutable_delete BEFORE DELETE ON private_runtime\\nBEGIN SELECT RAISE(ABORT, 'PRIVATE_RUNTIME_IMMUTABLE'); END;\",\n  \"CREATE TABLE IF NOT EXISTS dashboard_settings (\\n  id INTEGER PRIMARY KEY CHECK (id = 1),\\n  mode TEXT NOT NULL DEFAULT 'CLOSED' CHECK(mode IN ('TEST','HUMAN','CLOSED')),\\n  config_sha256 TEXT,\\n  consent_text_sha256 TEXT,\\n  researcher_config_json TEXT,\\n  consent_document_json TEXT,\\n  updated_at TEXT\\n);\",\n  \"INSERT OR IGNORE INTO dashboard_settings(id,mode) VALUES(1,'CLOSED');\",\n  \"CREATE TRIGGER IF NOT EXISTS dashboard_settings_no_delete BEFORE DELETE ON dashboard_settings\\nBEGIN SELECT RAISE(ABORT,'DASHBOARD_SETTINGS_CANNOT_BE_DELETED'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS dashboard_settings_locked BEFORE UPDATE ON dashboard_settings\\nWHEN EXISTS(SELECT 1 FROM study_run WHERE id=1 AND config_locked_at IS NOT NULL)\\n AND (NEW.config_sha256 IS NOT OLD.config_sha256 OR NEW.consent_text_sha256 IS NOT OLD.consent_text_sha256\\n OR NEW.researcher_config_json IS NOT OLD.researcher_config_json OR NEW.consent_document_json IS NOT OLD.consent_document_json)\\nBEGIN SELECT RAISE(ABORT,'CONFIG_LOCKED_AFTER_FIRST_CONSENT'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS dashboard_settings_no_test_after_human BEFORE UPDATE ON dashboard_settings\\nWHEN NEW.mode='TEST' AND EXISTS(SELECT 1 FROM sessions WHERE is_test=0)\\nBEGIN SELECT RAISE(ABORT,'CANNOT_REOPEN_TEST_MODE_AFTER_HUMAN_ENROLLMENT'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS dashboard_settings_validate BEFORE UPDATE ON dashboard_settings\\nWHEN NEW.config_sha256 IS NOT NULL\\nBEGIN\\n SELECT CASE WHEN length(NEW.config_sha256)!=64 OR length(NEW.consent_text_sha256)!=64\\n OR NOT json_valid(NEW.researcher_config_json) OR NOT json_valid(NEW.consent_document_json)\\n THEN RAISE(ABORT,'INVALID_DASHBOARD_CONFIGURATION') END;\\n -- Reusing an immutable hash with different contents must fail, not silently ignore the insert.\\n SELECT CASE WHEN EXISTS(SELECT 1 FROM config_snapshots c WHERE c.researcher_config_sha256=NEW.config_sha256\\n  AND (c.researcher_config_json IS NOT NEW.researcher_config_json OR c.consent_document_json IS NOT NEW.consent_document_json\\n   OR c.consent_text_sha256 IS NOT NEW.consent_text_sha256))\\n THEN RAISE(ABORT,'CONFIG_SNAPSHOT_IMMUTABLE') END;\\nEND;\",\n  \"-- A single dashboard UPDATE atomically saves the snapshot and changes the active pointer.\\nCREATE TRIGGER IF NOT EXISTS dashboard_settings_apply AFTER UPDATE ON dashboard_settings\\nBEGIN\\n INSERT OR IGNORE INTO config_snapshots(researcher_config_sha256,consent_template_version,consent_text_sha256,\\n  researcher_config_json,consent_document_json,study_version,first_seen_at,saved_by)\\n SELECT NEW.config_sha256,'PM-CONSENT-5',NEW.consent_text_sha256,NEW.researcher_config_json,\\n  NEW.consent_document_json,'0.38.3-pilot.1',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'cloudflare-d1-console'\\n WHERE NEW.config_sha256 IS NOT NULL;\\n UPDATE study_run SET active_config_sha256=NEW.config_sha256,\\n  recruitment_open=CASE WHEN NEW.mode='HUMAN' THEN 1 ELSE 0 END WHERE id=1;\\n INSERT INTO researcher_audit(at,action,detail) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),\\n  'dashboard-settings',NEW.mode || ':' || COALESCE(NEW.config_sha256,'not-configured'));\\nEND;\",\n  \"-- Recheck the site mode at INSERT commit time, not merely in earlier Worker reads.\\nCREATE TRIGGER IF NOT EXISTS cx_enrollment_mode_guard BEFORE INSERT ON sessions\\nBEGIN\\n SELECT CASE WHEN (NEW.is_test=1 AND (SELECT mode FROM dashboard_settings WHERE id=1)!='TEST')\\n  OR (NEW.is_test=0 AND (SELECT mode FROM dashboard_settings WHERE id=1)!='HUMAN')\\n THEN RAISE(ABORT,'COLLECTION_MODE_CHANGED') END;\\n SELECT CASE WHEN NEW.is_test NOT IN(0,1) THEN RAISE(ABORT,'INVALID_COLLECTION_MODE') END;\\n SELECT CASE WHEN (SELECT config_sha256 FROM dashboard_settings WHERE id=1)\\n  IS NOT json_extract(NEW.consent_config_json,'$.researcherConfigSha256')\\n THEN RAISE(ABORT,'CONSENT_CONFIG_MISMATCH') END;\\nEND;\",\n  \"-- test/human identity, allocation, credentials and consent ownership cannot change afterwards.\\nCREATE TRIGGER IF NOT EXISTS cx_session_identity_immutable BEFORE UPDATE ON sessions\\nWHEN NEW.is_test IS NOT OLD.is_test OR NEW.slot IS NOT OLD.slot OR NEW.run_id IS NOT OLD.run_id\\n OR NEW.arm IS NOT OLD.arm OR NEW.form_order IS NOT OLD.form_order OR NEW.assignment_json IS NOT OLD.assignment_json\\n OR NEW.enrollment_hash IS NOT OLD.enrollment_hash OR NEW.token_hash IS NOT OLD.token_hash\\n OR NEW.session_id IS NOT OLD.session_id OR NEW.study_version IS NOT OLD.study_version\\nBEGIN SELECT RAISE(ABORT,'SESSION_IDENTITY_IMMUTABLE'); END;\",\n  \"-- Compact account-only dashboard. No public HTTP route serves these views.\\nCREATE VIEW IF NOT EXISTS pm_status AS\\nSELECT (SELECT mode FROM dashboard_settings WHERE id=1) AS mode,\\n (SELECT COUNT(*) FROM sessions WHERE is_test=0) AS human_enrolled,\\n (SELECT COUNT(*) FROM sessions WHERE is_test=0 AND status='complete') AS human_complete,\\n (SELECT COUNT(*) FROM sessions WHERE is_test=0 AND status='withdrawn') AS human_withdrawn,\\n (SELECT COUNT(*) FROM sessions WHERE is_test=0 AND removed_at IS NOT NULL) AS human_removed,\\n (SELECT COUNT(*) FROM sessions WHERE is_test=1) AS test_enrolled,\\n (SELECT COUNT(*) FROM sessions WHERE is_test=1 AND status='complete') AS test_complete,\\n (SELECT config_locked_at FROM study_run WHERE id=1) AS config_locked_at;\",\n  \"CREATE VIEW IF NOT EXISTS pm_progress AS\\nSELECT session_id,is_test,slot,stage,status,\\n COALESCE(json_array_length(checkpoint_json,'$.responses.T0'),0) AS T0,\\n COALESCE(json_array_length(checkpoint_json,'$.responses.T1'),0) AS T1,\\n COALESCE(json_array_length(checkpoint_json,'$.responses.T2'),0) AS T2,\\n prediction_receipt_json IS NOT NULL AS prediction_committed,\\n technical_error_count,created_at,updated_at,removed_at FROM sessions;\",\n  \"CREATE VIEW IF NOT EXISTS pm_research_exports AS\\nSELECT s.session_id,s.is_test,s.slot,\\n json_object(\\n  'schema','political-mirror-research-export/1','collector','pm-cloud-collector/3.1.0',\\n  'exportedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),\\n  'sessionId',s.session_id,'studyVersion',s.study_version,'assignment',json(s.assignment_json),\\n  'consentConfig',json(s.consent_config_json),'consent',json(s.consent_json),\\n  'test',json(CASE WHEN s.is_test=1 THEN 'true' ELSE 'false' END),\\n  'simulated',json(CASE WHEN s.is_test=1 THEN 'true' ELSE 'false' END),\\n  'slot',s.slot,'revision',s.revision,'checkpoint',json(s.checkpoint_json),\\n  'prediction',json(s.prediction_json),'predictionReceipt',json(s.prediction_receipt_json),\\n  'createdAt',s.created_at,'updatedAt',s.updated_at,'removedAt',s.removed_at,\\n  'journalHeadSha256',s.last_event_sha256,'journalSequence',s.revision,\\n  'consentDocument',json(c.consent_document_json),'researcherConfig',json(c.researcher_config_json),\\n  'integrity',json_object(\\n    'ok',json(CASE WHEN s.removed_at IS NOT NULL THEN 'null'\\n     WHEN (SELECT COUNT(*) FROM session_events e WHERE e.session_id=s.session_id)=s.revision+1\\n      AND (SELECT MIN(sequence) FROM session_events WHERE session_id=s.session_id)=0\\n      AND (SELECT MAX(sequence) FROM session_events WHERE session_id=s.session_id)=s.revision\\n      AND (SELECT record_sha256 FROM session_events WHERE session_id=s.session_id ORDER BY sequence DESC LIMIT 1) IS s.last_event_sha256\\n      AND NOT EXISTS(SELECT 1 FROM session_events e LEFT JOIN session_events p\\n        ON p.session_id=e.session_id AND p.sequence=e.sequence-1\\n        WHERE e.session_id=s.session_id AND ((e.sequence=0 AND e.previous_sha256 IS NOT NULL)\\n          OR (e.sequence>0 AND (p.sequence IS NULL OR e.previous_sha256 IS NOT p.record_sha256))))\\n     THEN 'true' ELSE 'false' END),\\n    'disposition',CASE WHEN s.removed_at IS NOT NULL THEN 'intentionally_removed' ELSE 'retained' END),\\n  'events',json((SELECT json_group_array(json_object('session_id',e.session_id,'sequence',e.sequence,\\n    'type',e.type,'at',e.at,'revision',e.revision,'stage',e.stage,'record_sha256',e.record_sha256,\\n    'previous_sha256',e.previous_sha256,'summary',json(e.summary_json)))\\n    FROM (SELECT * FROM session_events WHERE session_id=s.session_id ORDER BY sequence) e))\\n ) AS research_json\\nFROM sessions s LEFT JOIN config_snapshots c\\n ON c.researcher_config_sha256=json_extract(s.consent_config_json,'$.researcherConfigSha256');\",\n  \"-- One account-authenticated statement atomically removes all research contents. No public API.\\n-- INSERT INTO pm_remove_data(session_id,note) VALUES('actual-session-id','withdrawal request');\\nCREATE VIEW IF NOT EXISTS pm_remove_data AS SELECT session_id,removal_note AS note FROM sessions WHERE 0;\",\n  \"CREATE TRIGGER IF NOT EXISTS pm_remove_data_apply INSTEAD OF INSERT ON pm_remove_data\\nBEGIN\\n SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE session_id=NEW.session_id)\\n  THEN RAISE(ABORT,'SESSION_NOT_FOUND') END;\\n UPDATE sessions SET revision=revision+1,checkpoint_json=NULL,checkpoint_sha256=NULL,\\n  prediction_json=NULL,prediction_receipt_json=NULL,consent_json=NULL,last_event_sha256=NULL,\\n  status='removed',stage='REMOVED',technical_error_count=0,\\n  removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),removal_note=substr(NEW.note,1,500),\\n  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')\\n WHERE session_id=NEW.session_id AND removed_at IS NULL;\\n DELETE FROM session_events WHERE session_id=NEW.session_id;\\n DELETE FROM session_requests WHERE session_id=NEW.session_id;\\n DELETE FROM prediction_items WHERE session_id=NEW.session_id;\\n DELETE FROM prediction_commits WHERE session_id=NEW.session_id;\\n DELETE FROM consent_records WHERE session_id=NEW.session_id;\\n INSERT INTO researcher_audit(at,action,detail) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),\\n  'dashboard-data-removed',NEW.session_id);\\nEND;\",\n  \"-- Auto-storage deployment metadata. No public HTTP endpoint can write this table.\\nCREATE TABLE IF NOT EXISTS storage_installation (id INTEGER PRIMARY KEY CHECK(id=1), product TEXT NOT NULL, schema_version INTEGER NOT NULL);\",\n  \"INSERT OR IGNORE INTO storage_installation VALUES(1,'political-mirror-autostorage',6);\",\n  \"CREATE TABLE IF NOT EXISTS deployment_state (\\n id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0,\\n manifest_sha256 TEXT, config_sha256 TEXT, consent_text_sha256 TEXT,\\n researcher_config_json TEXT, consent_document_json TEXT,\\n removal_ids_json TEXT NOT NULL DEFAULT '[]',\\n mode TEXT NOT NULL DEFAULT 'CLOSED' CHECK(mode IN('TEST','HUMAN','CLOSED')), updated_at TEXT\\n);\",\n  \"INSERT OR IGNORE INTO deployment_state(id,revision,mode) VALUES(1,0,'CLOSED');\",\n  \"CREATE TRIGGER IF NOT EXISTS deployment_revision_monotonic BEFORE UPDATE ON deployment_state\\nWHEN NEW.revision <= OLD.revision\\nBEGIN SELECT RAISE(ABORT,'DEPLOYMENT_REVISION_NOT_NEWER'); END;\",\n  \"CREATE TRIGGER IF NOT EXISTS deployment_state_apply AFTER UPDATE ON deployment_state\\nBEGIN\\n UPDATE dashboard_settings SET mode=NEW.mode,config_sha256=NEW.config_sha256,\\n consent_text_sha256=NEW.consent_text_sha256,researcher_config_json=NEW.researcher_config_json,\\n consent_document_json=NEW.consent_document_json,updated_at=NEW.updated_at WHERE id=1;\\n INSERT INTO pm_remove_data(session_id,note) SELECT value,'Account-authorized deployment removal' FROM json_each(NEW.removal_ids_json);\\nEND;\",\n  \"-- An ordinary table (not just a SQL view) for the account owner's D1 Tables screen.\\n-- One row per pseudonymous participant. No auth tokens or runtime secret in this table.\\nCREATE TABLE IF NOT EXISTS participants (\\n participant_code TEXT PRIMARY KEY,\\n session_id TEXT NOT NULL UNIQUE,\\n is_test INTEGER NOT NULL,\\n status TEXT NOT NULL,\\n last_stage TEXT,\\n T0_answers INTEGER NOT NULL DEFAULT 0,\\n T1_answers INTEGER NOT NULL DEFAULT 0,\\n T2_answers INTEGER NOT NULL DEFAULT 0,\\n prediction_saved INTEGER NOT NULL DEFAULT 0,\\n updated_at TEXT NOT NULL,\\n research_json TEXT NOT NULL,\\n remove_requested INTEGER NOT NULL DEFAULT 0 CHECK(remove_requested IN(0,1))\\n);\",\n  \"CREATE TRIGGER IF NOT EXISTS participants_refresh AFTER INSERT ON session_events\\nBEGIN\\n INSERT INTO participants(participant_code,session_id,is_test,status,last_stage,\\n T0_answers,T1_answers,T2_answers,prediction_saved,updated_at,research_json)\\n SELECT CASE WHEN s.is_test=1 THEN printf('TEST%03d',s.slot-1000000+1) ELSE printf('P%03d',s.slot+1) END,\\n s.session_id,s.is_test,s.status,s.stage,\\n COALESCE(json_array_length(s.checkpoint_json,'$.responses.T0'),0),\\n COALESCE(json_array_length(s.checkpoint_json,'$.responses.T1'),0),\\n COALESCE(json_array_length(s.checkpoint_json,'$.responses.T2'),0),\\n CASE WHEN s.prediction_receipt_json IS NULL THEN 0 ELSE 1 END,s.updated_at,e.research_json\\n FROM sessions s JOIN pm_research_exports e ON e.session_id=s.session_id\\n WHERE s.session_id=NEW.session_id AND s.removed_at IS NULL\\n ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,last_stage=excluded.last_stage,\\n T0_answers=excluded.T0_answers,T1_answers=excluded.T1_answers,T2_answers=excluded.T2_answers,\\n prediction_saved=excluded.prediction_saved,updated_at=excluded.updated_at,research_json=excluded.research_json;\\nEND;\",\n  \"CREATE TRIGGER IF NOT EXISTS participants_clear AFTER UPDATE OF removed_at ON sessions\\nWHEN NEW.removed_at IS NOT NULL\\nBEGIN\\n UPDATE participants SET status='removed',last_stage='REMOVED',T0_answers=0,T1_answers=0,T2_answers=0,\\n prediction_saved=0,updated_at=NEW.updated_at,remove_requested=1,\\n research_json=json_object('schema','political-mirror-research-export/1','sessionId',NEW.session_id,\\n 'studyVersion',NEW.study_version,'slot',NEW.slot,'revision',NEW.revision,\\n 'test',json(CASE WHEN NEW.is_test=1 THEN 'true' ELSE 'false' END),\\n 'simulated',json(CASE WHEN NEW.is_test=1 THEN 'true' ELSE 'false' END),\\n 'removedAt',NEW.removed_at,'checkpoint',NULL,'prediction',NULL,\\n 'integrity',json_object('ok',NULL,'disposition','intentionally_removed'))\\n WHERE session_id=NEW.session_id;\\nEND;\",\n  \"CREATE TRIGGER IF NOT EXISTS participants_removal_request AFTER UPDATE OF remove_requested ON participants\\nWHEN NEW.remove_requested=1 AND OLD.remove_requested=0\\n AND EXISTS(SELECT 1 FROM sessions WHERE session_id=NEW.session_id AND removed_at IS NULL)\\nBEGIN\\n INSERT INTO pm_remove_data(session_id,note) VALUES(NEW.session_id,'Cloudflare account data-removal request');\\nEND;\",\n  \"CREATE TRIGGER IF NOT EXISTS participants_no_direct_delete BEFORE DELETE ON participants\\nBEGIN SELECT RAISE(ABORT,'SET_REMOVE_REQUESTED_INSTEAD_OF_DELETING_RECORD'); END;\",\n  \"INSERT OR IGNORE INTO schema_version(id,version,applied_at) VALUES(1,6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));\"\n]\n");
}],
"pilot/researcher-config.mjs": [{"./sha256.mjs":"pilot/sha256.mjs","./assignment.mjs":"pilot/assignment.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ETHICS_ARRANGEMENTS = exports.RESEARCHER_CONFIG_SCHEMA = void 0;
exports.loadResearcherConfig = loadResearcherConfig;
// Researcher-side configuration (one file, one validator) shared by the Node collector, the
// Cloudflare Worker and the consent page. Participant consent is a separate act recorded per
// session; this file describes the study as the researcher confirms it.
const sha256_mjs_1 = require("./sha256.mjs");
const assignment_mjs_1 = require("./assignment.mjs");
exports.RESEARCHER_CONFIG_SCHEMA = 'pm-researcher-config/2';
exports.ETHICS_ARRANGEMENTS = Object.freeze(['SUPERVISOR_HANDLED', 'COMMITTEE_APPROVED', 'COMMITTEE_EXEMPT', 'NOT_SUPPLIED']);
const PLACEHOLDER = /TODO|PLACEHOLDER|XXXX|FAKE|TBD|EXAMPLE|LOREM|填入|待填/i;
const text = (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
function loadResearcherConfig(raw) {
    if (!raw || typeof raw !== 'object' || (raw.schema !== undefined && raw.schema !== exports.RESEARCHER_CONFIG_SCHEMA))
        throw new Error('INVALID_RESEARCHER_CONFIG_SCHEMA');
    raw = { ...raw, schema: exports.RESEARCHER_CONFIG_SCHEMA };
    const ethics = raw.ethics && typeof raw.ethics === 'object' ? raw.ethics : {};
    const recruitment = raw.recruitment && typeof raw.recruitment === 'object' ? raw.recruitment : {};
    const config = {
        schema: raw.schema,
        studyTitle: text(raw.studyTitle), principalInvestigator: text(raw.principalInvestigator), institution: text(raw.institution),
        contactEmail: text(raw.contactEmail),
        estimatedDurationMinutes: Number.isFinite(raw.estimatedDurationMinutes) && raw.estimatedDurationMinutes > 0 ? Math.round(raw.estimatedDurationMinutes) : null,
        durationEstimateBasis: text(raw.durationEstimateBasis),
        dataRetention: text(raw.dataRetention), dataAccess: text(raw.dataAccess), withdrawalProcedure: text(raw.withdrawalProcedure),
        ethics: { arrangement: exports.ETHICS_ARRANGEMENTS.includes(ethics.arrangement) ? ethics.arrangement : 'NOT_SUPPLIED',
            statement: text(ethics.statement), body: text(ethics.body), reference: text(ethics.reference), researcherConfirmed: ethics.researcherConfirmed === true },
        recruitment: { targetAllocations: Number.isSafeInteger(recruitment.targetAllocations) && recruitment.targetAllocations > 0 ? recruitment.targetAllocations : 20,
            allocationRule: text(recruitment.allocationRule) || 'The first 20 allocated sessions (consented and randomised) count toward the pilot, including later dropouts; completion rates are reported.',
            stopRule: text(recruitment.stopRule) || 'Recruitment stops when 20 sessions are allocated or at the declared cutoff date, whichever comes first; no participant is added or removed on the basis of results.' },
    };
    const blockers = [];
    if (!config.studyTitle)
        blockers.push('STUDY_TITLE_MISSING');
    if (!config.contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.contactEmail))
        blockers.push('CONTACT_EMAIL_MISSING');
    if (!config.principalInvestigator)
        blockers.push('PRINCIPAL_INVESTIGATOR_NOT_SUPPLIED');
    if (!config.institution)
        blockers.push('INSTITUTION_NOT_SUPPLIED');
    if (!config.estimatedDurationMinutes || !config.durationEstimateBasis)
        blockers.push('DURATION_ESTIMATE_NOT_SUPPLIED');
    if (!config.dataRetention)
        blockers.push('DATA_RETENTION_NOT_SUPPLIED');
    if (!config.dataAccess)
        blockers.push('DATA_ACCESS_NOT_SUPPLIED');
    if (!config.withdrawalProcedure)
        blockers.push('WITHDRAWAL_PROCEDURE_NOT_SUPPLIED');
    if (config.ethics.arrangement === 'NOT_SUPPLIED' || !config.ethics.statement)
        blockers.push('ETHICS_ARRANGEMENT_NOT_SUPPLIED');
    if (config.ethics.arrangement !== 'NOT_SUPPLIED' && !config.ethics.researcherConfirmed)
        blockers.push('ETHICS_NOT_CONFIRMED_BY_RESEARCHER');
    if (['COMMITTEE_APPROVED', 'COMMITTEE_EXEMPT'].includes(config.ethics.arrangement) && !(config.ethics.body && config.ethics.reference))
        blockers.push('COMMITTEE_REFERENCE_MISSING');
    for (const v of [config.ethics.statement, config.ethics.body, config.ethics.reference, config.dataRetention, config.dataAccess, config.withdrawalProcedure, config.principalInvestigator, config.institution]) {
        if (v && PLACEHOLDER.test(v)) {
            blockers.push('PLACEHOLDER_TEXT_PRESENT');
            break;
        }
    }
    return { config, blockers, sha256: (0, sha256_mjs_1.sha256Hex)((0, assignment_mjs_1.stableJSON)(config)) };
}

}],
"pilot/sha256.mjs": [{}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Bytes = sha256Bytes;
exports.sha256Hex = sha256Hex;
exports.hmacSha256Bytes = hmacSha256Bytes;
exports.hmacSha256Base64url = hmacSha256Base64url;
exports.hmacSha256Hex = hmacSha256Hex;
exports.timingSafeEqualString = timingSafeEqualString;
// Portable synchronous SHA-256 / HMAC-SHA-256 (UTF-8 input, hex output) so the Cloudflare
// Worker, the Node collector and the browser produce identical hashes without WebCrypto's
// asynchronous API. Verified against node:crypto in pilot-tests/cloud.test.mjs.
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const encoder = new TextEncoder();
function toBytes(input) { return input instanceof Uint8Array ? input : encoder.encode(String(input)); }
function sha256Bytes(input) {
    const msg = toBytes(input);
    const l = msg.length;
    const total = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[l] = 0x80;
    const view = new DataView(buf.buffer);
    const bits = l * 8;
    view.setUint32(total - 8, Math.floor(bits / 4294967296));
    view.setUint32(total - 4, bits >>> 0);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15], b = w[i - 2];
            const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
            const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0;
        h[1] = (h[1] + b) >>> 0;
        h[2] = (h[2] + c) >>> 0;
        h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0;
        h[5] = (h[5] + f) >>> 0;
        h[6] = (h[6] + g) >>> 0;
        h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
        out[i * 4] = h[i] >>> 24;
        out[i * 4 + 1] = (h[i] >>> 16) & 255;
        out[i * 4 + 2] = (h[i] >>> 8) & 255;
        out[i * 4 + 3] = h[i] & 255;
    }
    return out;
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
function sha256Hex(input) { return hex(sha256Bytes(input)); }
function hmacSha256Bytes(key, message) {
    let k = toBytes(key);
    if (k.length > 64)
        k = sha256Bytes(k);
    const pad = new Uint8Array(64);
    pad.set(k);
    const ipad = pad.map((x) => x ^ 0x36), opad = pad.map((x) => x ^ 0x5c);
    const inner = new Uint8Array(64 + toBytes(message).length);
    inner.set(ipad);
    inner.set(toBytes(message), 64);
    const innerHash = sha256Bytes(inner);
    const outer = new Uint8Array(96);
    outer.set(opad);
    outer.set(innerHash, 64);
    return sha256Bytes(outer);
}
function hmacSha256Base64url(key, message) {
    const bytes = hmacSha256Bytes(key, message);
    let s = '';
    for (const b of bytes)
        s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hmacSha256Hex(key, message) { return hex(hmacSha256Bytes(key, message)); }
function timingSafeEqualString(a, b) {
    const x = toBytes(a), y = toBytes(b);
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++)
        diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
    return diff === 0;
}

}],
"pilot/assignment.mjs": [{"./sha256.mjs":"pilot/sha256.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORM_ORDERS = exports.ASSIGNMENT_VERSION = void 0;
exports.assignmentForSlot = assignmentForSlot;
exports.stableJSON = stableJSON;
exports.enrollmentToken = enrollmentToken;
// Deterministic block randomisation shared by the Node collector and the Cloudflare Worker.
// Slot zero is the first allocation, including sessions that later drop out.
const sha256_mjs_1 = require("./sha256.mjs");
exports.ASSIGNMENT_VERSION = 'PM-BLOCK6-1';
exports.FORM_ORDERS = Object.freeze([['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']]);
function assignmentForSlot(slot, runKey, runId = 'pilot-run') {
    if (!Number.isSafeInteger(slot) || slot < 0)
        throw new Error('INVALID_SLOT');
    const block = Math.floor(slot / 6), within = slot % 6;
    const forms = [0, 1, 2].sort((a, b) => (0, sha256_mjs_1.sha256Hex)(`${runKey}|${block}|form|${a}`).localeCompare((0, sha256_mjs_1.sha256Hex)(`${runKey}|${block}|form|${b}`)));
    const form = forms[Math.floor(within / 2)];
    const firstTrue = (parseInt((0, sha256_mjs_1.sha256Hex)(`${runKey}|${block}|arm|${form}`).slice(0, 2), 16) & 1) === 0;
    const arm = (within % 2 === 0 ? firstTrue : !firstTrue) ? 'TRUE' : 'SHUFFLED';
    return { slot, arm, formOrder: [...exports.FORM_ORDERS[form]], assignmentVersion: exports.ASSIGNMENT_VERSION, runId };
}
function stableJSON(value) {
    if (Array.isArray(value))
        return '[' + value.map(stableJSON).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}';
    return JSON.stringify(value);
}
function enrollmentToken(runKey, sessionId, requestId) {
    return hmacSha256Base64urlWrapper(runKey, 'PM-ENROLL|' + sessionId + '|' + requestId);
}
const sha256_mjs_2 = require("./sha256.mjs");
function hmacSha256Base64urlWrapper(key, message) { return (0, sha256_mjs_2.hmacSha256Base64url)(key, message); }

}],
"pilot/consent-text.mjs": [{"./sha256.mjs":"pilot/sha256.mjs","./assignment.mjs":"pilot/assignment.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSENT_TEMPLATE_VERSION = void 0;
exports.buildConsentDocument = buildConsentDocument;
exports.consentDocumentSha256 = consentDocumentSha256;
// Participant consent document. One template, versioned; the rendered document is derived
// from the template plus the researcher configuration, hashed identically in the browser,
// the Node collector and the Cloudflare Worker, and the hash is stored with each consent.
const sha256_mjs_1 = require("./sha256.mjs");
const assignment_mjs_1 = require("./assignment.mjs");
exports.CONSENT_TEMPLATE_VERSION = 'PM-CONSENT-5';
function buildConsentDocument(researcher = {}) {
    const r = researcher, e = r.ethics || {};
    const duration = r.estimatedDurationMinutes ? `about ${r.estimatedDurationMinutes} minutes (${r.durationEstimateBasis || 'researcher estimate'})` : 'a duration the researcher has not yet confirmed';
    const arrangement = {
        SUPERVISOR_HANDLED: 'Ethics arrangement: handled by the supervising researcher as described below.',
        COMMITTEE_APPROVED: `Ethics review: approved${e.body ? ` by ${e.body}` : ''}${e.reference ? ` (reference ${e.reference})` : ''}.`,
        COMMITTEE_EXEMPT: `Ethics review: exempt${e.body ? ` per ${e.body}` : ''}${e.reference ? ` (reference ${e.reference})` : ''}.`,
        NOT_SUPPLIED: 'ETHICS INFORMATION NOT YET SUPPLIED BY THE RESEARCHER. This page may only be used for technical testing.',
    }[e.arrangement || 'NOT_SUPPLIED'];
    return {
        version: exports.CONSENT_TEMPLATE_VERSION,
        title: r.studyTitle || 'Political Mirror pilot study',
        researcherLine: `${r.principalInvestigator ? `Researcher: ${r.principalInvestigator}` : 'Researcher: not yet named in the researcher configuration'}${r.institution ? ` · ${r.institution}` : ''} · Contact: ${r.contactEmail || ''}`,
        sections: [
            { heading: 'What this study is about', paragraphs: ['This research explores how people make political judgments before and after playing a fictional political career and reading feedback about it. All characters, parties and events are fictional. The results are intended for a conference pilot paper and research presentations.'] },
            { heading: 'What you will do', paragraphs: [`You will judge three sets of eight short fictional cases about officials accused of misconduct, play one fictional political career in which you make public decisions and private judgments, read feedback about your play, and answer optional questions about your experience. Expect ${duration}. You may pause and return on this browser. Some material concerns misconduct, accusations and political disagreement; the tasks can be tiring and you may take breaks.`] },
            { heading: 'Voluntary participation and your right to stop', paragraphs: ['Taking part is voluntary. You may stop at any time, without giving a reason and without any disadvantage, by choosing “Stop participation”. When the server confirms your stop request, the study deletes your submitted answers, game records, predictions and questionnaire from its active database. Only a minimal coded withdrawal record remains to prevent reuse of your place and to provide the debrief. If the connection fails, the page will say that deletion has not yet been confirmed; please retry or email the researcher with your session code. If you stop after the feedback has been shown, an explanation of what that feedback was stays available on the same browser. Closing the page or losing your connection does not end your participation; you can continue later on the same browser.'] },
            { heading: 'Your data and privacy', paragraphs: ['We record your case judgments, game choices and private in-game judgments, response and elapsed times, career outcomes, the feedback shown to you, questionnaire answers, and technical and completion records under a randomly generated session code. We do not ask for your name; please do not enter your name or other identifying details in free-text answers. The records are pseudonymous (linked to a code, not to your identity), not absolutely anonymous. The study is hosted on Cloudflare, whose platform processes ordinary connection metadata to deliver the service; the study application itself does not store IP addresses or browser identifiers with your responses.',
                    `Data retention: ${r.dataRetention || 'not yet specified by the researcher'}.`, `Who can access the data: ${r.dataAccess || 'not yet specified by the researcher'}.`,
                    `Withdrawal of data: ${r.withdrawalProcedure || 'not yet specified by the researcher'}`, 'Deletion from the active study database does not instantly erase copies previously downloaded by the research team or Cloudflare recovery history. The researcher handles those copies according to the stated withdrawal arrangement and excludes withdrawn responses from further analysis. Previously published aggregate findings cannot be retrospectively separated into individual records.'] },
            { heading: 'Feedback', paragraphs: ['Different participants receive different feedback. Some feedback is drawn from the participant’s own recorded play, while some uses a fixed comparison profile. The precise assignment is explained at the end of the study. These profiles and any predictions are research tools, not validated psychological diagnoses, and nothing in this study is advice about real political choices.'] },
            { heading: 'Ethics and contact', paragraphs: [arrangement, e.statement || '', `Questions or concerns: ${r.contactEmail || ''}.`].filter(Boolean) },
        ],
        confirmations: [
            { id: 'adult', text: 'I confirm that I am 18 years old or older.' },
            { id: 'english', text: 'I can comfortably read the English instructions, cases and game.' },
            { id: 'informed', text: 'I have read the information above and I understand that taking part is voluntary and that I can stop at any time.' },
            { id: 'agreed', text: 'I agree to take part in this study and to the described use of my responses.' },
        ],
    };
}
function consentDocumentSha256(researcher) { return (0, sha256_mjs_1.sha256Hex)((0, assignment_mjs_1.stableJSON)(buildConsentDocument(researcher))); }

}],
"pilot/study.mjs": [{"./consent-validator.mjs":"pilot/consent-validator.mjs","./cases.mjs":"pilot/cases.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGES = exports.CONSENT_VERSION = exports.STUDY_VERSION = void 0;
exports.formFor = formFor;
exports.createStudy = createStudy;
exports.consentStudy = consentStudy;
exports.presentItem = presentItem;
exports.answerItem = answerItem;
exports.checkpointGame = checkpointGame;
exports.completeGame = completeGame;
exports.attachPrediction = attachPrediction;
exports.finishMirror = finishMirror;
exports.updateQuestionnaire = updateQuestionnaire;
exports.finishSurvey = finishSurvey;
exports.completeStudy = completeStudy;
exports.withdrawStudy = withdrawStudy;
exports.recordTechnicalError = recordTechnicalError;
exports.markResume = markResume;
exports.validateStudyState = validateStudyState;
exports.validateStudyTransition = validateStudyTransition;
const consent_validator_mjs_1 = require("./consent-validator.mjs");
const cases_mjs_1 = require("./cases.mjs");
exports.STUDY_VERSION = '0.38.3-pilot.1';
exports.CONSENT_VERSION = 'PM-CONSENT-5';
exports.STAGES = ['CONSENT', 'T0', 'GAME', 'PREDICTION', 'T1', 'MIRROR', 'T2', 'SURVEY', 'DEBRIEF', 'COMPLETE'];
const clone = x => structuredClone(x);
const iso = value => new Date(value ?? Date.now()).toISOString();
const insist = (condition, message) => { if (!condition)
    throw new Error(message); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validDate = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const validScore = x => Number.isInteger(x) && x >= 0 && x <= 100;
function requireStage(s, stage) { insist(s.stage === stage, `Expected ${stage}, received ${s.stage}`); }
function event(s, type, now, detail = {}) {
    const at = iso(now);
    s.timestamps.updatedAt = at;
    s.events.push({ seq: s.events.length + 1, type, at, stage: s.stage, ...detail });
    return s;
}
function mutable(s) { validateStudyState(s); return clone(s); }
function formFor(s, block) { return s.assignment.formOrder[['T0', 'T1', 'T2'].indexOf(block)]; }
function createStudy({ sessionId, assignment, coreGame, now }) {
    const at = iso(now);
    const s = { schema: 'political-mirror-study/1', studyVersion: exports.STUDY_VERSION, coreGame: clone(coreGame), consentVersion: exports.CONSENT_VERSION,
        participantId: sessionId, sessionId, assignment: clone(assignment), stage: 'CONSENT', consent: null,
        responses: { T0: [], T1: [], T2: [] }, presentation: null, game: null, prediction: null, predictionReceipt: null,
        questionnaire: {}, timestamps: { createdAt: at, updatedAt: at }, events: [], status: 'in_progress', technicalErrors: [] };
    event(s, 'SESSION_CREATED', at);
    validateStudyState(s);
    return s;
}
function consentStudy(state, answers, now, { at } = {}) {
    const s = mutable(state);
    requireStage(s, 'CONSENT');
    let valid;
    try {
        valid = (0, consent_validator_mjs_1.validateConsentSubmission)(answers);
    }
    catch (e) {
        throw new Error(`Active consent is required (${e.message})`);
    }
    if (at !== undefined)
        insist(typeof at === 'string' && !Number.isNaN(Date.parse(at)), 'Invalid server consent time');
    s.consent = { ...valid, at: at ?? iso(now), version: exports.CONSENT_VERSION };
    s.stage = 'T0';
    return event(s, 'CONSENT_ACCEPTED', now);
}
function presentItem(state, now) {
    const s = mutable(state);
    insist(['T0', 'T1', 'T2'].includes(s.stage), 'Not a measurement stage');
    if (s.presentation)
        return s;
    if (s.stage === 'T1')
        insist(s.prediction && s.predictionReceipt, 'Prediction must be durably committed before T1');
    const item = (0, cases_mjs_1.getCases)(formFor(s, s.stage))[s.responses[s.stage].length];
    insist(item, 'No remaining item');
    s.presentation = { block: s.stage, caseId: item.id, presentedAt: iso(now) };
    return event(s, 'ITEM_PRESENTED', now, { block: s.stage, caseId: item.id });
}
function answerItem(state, { score, vote }, now) {
    const s = mutable(state);
    insist(s.presentation?.block === s.stage, 'Item must be saved before response');
    insist(validScore(score), 'Judgment must be an integer from 0 to 100');
    insist(['RETAIN', 'REPLACE'].includes(vote), 'Choose retain or replace');
    const block = s.stage, at = iso(now), p = s.presentation;
    insist(Date.parse(at) >= Date.parse(p.presentedAt), 'Response precedes presentation');
    s.responses[block].push({ caseId: p.caseId, score, vote, presentedAt: p.presentedAt, answeredAt: at, rtMs: Date.parse(at) - Date.parse(p.presentedAt) });
    s.presentation = null;
    event(s, 'ITEM_ANSWERED', at, { block, caseId: p.caseId });
    if (s.responses[block].length === 8) {
        s.stage = { T0: 'GAME', T1: 'MIRROR', T2: 'SURVEY' }[block];
        s.timestamps[`${block}CompletedAt`] = at;
        event(s, 'BLOCK_COMPLETED', at, { block });
    }
    validateStudyState(s);
    return s;
}
function checkpointGame(state, snapshot, now) {
    const s = mutable(state);
    insist(['GAME', 'MIRROR', 'SURVEY'].includes(s.stage), 'Game snapshot is not accepted here');
    validateGameSnapshot(s, snapshot);
    s.game = clone(snapshot);
    if (s.stage === 'SURVEY')
        s.questionnaire = clone(snapshot.presentation?.survey || s.questionnaire);
    return event(s, 'GAME_CHECKPOINT', now, { canonicalHash: snapshot.canonicalHash, actionCount: snapshot.transcript.length });
}
function completeGame(state, snapshot, now) {
    const s = mutable(state);
    requireStage(s, 'GAME');
    validateGameSnapshot(s, snapshot);
    insist(snapshot.canonicalState?.phase === 'MINI_MIRROR', 'Career must reach its canonical end');
    s.game = clone(snapshot);
    s.stage = 'PREDICTION';
    s.timestamps.gameCompletedAt = iso(now);
    return event(s, 'GAME_COMPLETED_BEFORE_FEEDBACK', now, { canonicalHash: snapshot.canonicalHash });
}
function attachPrediction(state, prediction, receipt, now) {
    const s = mutable(state);
    requireStage(s, 'PREDICTION');
    insist(receipt?.predictionSha256 && validDate(receipt.committedAt), 'Durable prediction receipt required');
    s.prediction = clone(prediction);
    s.predictionReceipt = clone(receipt);
    s.stage = 'T1';
    s.timestamps.predictionCommittedAt = receipt.committedAt;
    event(s, 'PREDICTION_COMMITTED', now, { predictionSha256: receipt.predictionSha256 });
    validateStudyState(s);
    return s;
}
function finishMirror(state, snapshot, now) {
    const s = mutable(state);
    requireStage(s, 'MIRROR');
    validateGameSnapshot(s, snapshot);
    insist(s.responses.T1.length === 8, 'T1 must precede feedback');
    s.game = clone(snapshot);
    s.stage = 'T2';
    s.timestamps.mirrorCompletedAt = iso(now);
    return event(s, 'MIRROR_COMPLETED', now);
}
function updateQuestionnaire(state, answers, snapshot, now) {
    const s = mutable(state);
    requireStage(s, 'SURVEY');
    validateGameSnapshot(s, snapshot);
    s.questionnaire = clone(answers);
    s.game = clone(snapshot);
    return event(s, 'QUESTIONNAIRE_SAVED', now);
}
function finishSurvey(state, answers, snapshot, now) {
    const s = updateQuestionnaire(state, answers, snapshot, now);
    s.stage = 'DEBRIEF';
    s.timestamps.surveyCompletedAt = iso(now);
    return event(s, 'SURVEY_COMPLETED', now);
}
function completeStudy(state, now) {
    const s = mutable(state);
    requireStage(s, 'DEBRIEF');
    s.stage = 'COMPLETE';
    s.status = 'complete';
    s.timestamps.completedAt = iso(now);
    return event(s, 'DEBRIEF_ACKNOWLEDGED', now);
}
function withdrawStudy(state, now, { reason = 'participant_stop', dataRemovalRequested = false } = {}) {
    const s = mutable(state);
    insist(!['COMPLETE', 'WITHDRAWN'].includes(s.stage), 'Already finished');
    insist(['participant_stop', 'participant_stop_remove_data', 'declined_consent'].includes(reason), 'Invalid withdrawal reason');
    const seen = exports.STAGES.indexOf(s.stage) > exports.STAGES.indexOf('MIRROR') || (s.stage === 'MIRROR' && !!s.game?.mirror);
    s.withdrawal = { at: iso(now), reason, stageAtStop: s.stage, sawFeedback: seen, feedbackArm: seen ? s.assignment.arm : null, dataRemovalRequested: dataRemovalRequested === true || reason === 'participant_stop_remove_data' };
    s.stage = 'WITHDRAWN';
    s.status = 'withdrawn';
    s.timestamps.withdrawnAt = iso(now);
    s.presentation = null;
    return event(s, 'PARTICIPATION_STOPPED', now);
}
function recordTechnicalError(state, error, now) {
    const s = clone(state);
    s.technicalErrors.push({ at: iso(now), message: String(error?.message || error).slice(0, 1000), stage: s.stage });
    return event(s, 'TECHNICAL_ERROR', now);
}
function markResume(state, now) { const s = mutable(state); return event(s, 'SESSION_RESUMED', now); }
function validateGameSnapshot(s, g) {
    insist(g?.schema === 'political-mirror-study-game/1', 'Missing game snapshot');
    insist(g.sessionId === s.sessionId && g.arm === s.assignment.arm, 'Game identity/arm changed');
    insist(g.spec?.testMode === 'natural' && g.spec?.agentCount === 700, 'Unexpected game configuration');
    insist(Array.isArray(g.transcript) && g.canonicalState && typeof g.canonicalHash === 'string', 'Incomplete canonical snapshot');
    insist(g.telemetry && typeof g.telemetry === 'object', 'Game telemetry missing');
    if (s.game) {
        insist(g.transcript.length >= s.game.transcript.length, 'Canonical actions cannot disappear');
        insist(eq(g.transcript.slice(0, s.game.transcript.length), s.game.transcript), 'Canonical history changed');
        if (s.stage !== 'GAME')
            insist(eq(g.canonicalState, s.game.canonicalState) && g.canonicalHash === s.game.canonicalHash, 'Feedback/survey must not alter canonical state');
    }
}
function validateStudyState(s, { predictionCommitted } = {}) {
    insist(s?.schema === 'political-mirror-study/1' && s.studyVersion === exports.STUDY_VERSION, 'Unknown study schema/version');
    insist(typeof s.sessionId === 'string' && s.participantId === s.sessionId, 'Participant/session mismatch');
    insist(s.coreGame?.version === '0.37.2' && /^[a-f0-9]{64}$/.test(s.coreGame.buildHash) && /^[a-f0-9]{64}$/.test(s.coreGame.sourceManifestHash), 'Frozen build identity missing');
    insist(s.consentVersion === exports.CONSENT_VERSION, 'Consent version mismatch');
    insist(['TRUE', 'SHUFFLED'].includes(s.assignment?.arm), 'Unknown arm');
    insist(['ABC', 'BCA', 'CAB'].includes(s.assignment?.formOrder?.join('')), 'Unknown parallel form order');
    insist([...exports.STAGES, 'WITHDRAWN'].includes(s.stage), 'Unknown stage');
    insist(s.status === ({ 'COMPLETE': 'complete', 'WITHDRAWN': 'withdrawn' }[s.stage] || 'in_progress'), 'Status/stage mismatch');
    insist(validDate(s.timestamps?.createdAt) && validDate(s.timestamps?.updatedAt), 'Invalid timestamps');
    insist(Array.isArray(s.events) && Array.isArray(s.technicalErrors), 'Audit arrays missing');
    s.events.forEach((e, i) => insist(e.seq === i + 1 && validDate(e.at), 'Invalid event sequence'));
    if (!['CONSENT', 'WITHDRAWN'].includes(s.stage))
        insist((0, consent_validator_mjs_1.consentRecordIsComplete)(s.consent) && s.consent.version === exports.CONSENT_VERSION, 'Active consent required');
    for (const block of ['T0', 'T1', 'T2']) {
        const rows = s.responses?.[block];
        insist(Array.isArray(rows) && rows.length <= 8, `Invalid ${block} rows`);
        const cases = (0, cases_mjs_1.getCases)(formFor(s, block));
        rows.forEach((r, i) => insist(r.caseId === cases[i].id && validScore(r.score) && ['RETAIN', 'REPLACE'].includes(r.vote) && validDate(r.presentedAt) && validDate(r.answeredAt) && Date.parse(r.answeredAt) >= Date.parse(r.presentedAt) && Number.isFinite(r.rtMs) && r.rtMs === Date.parse(r.answeredAt) - Date.parse(r.presentedAt), `Invalid ${block} response ${i}`));
    }
    if (s.stage === 'CONSENT')
        insist(Object.values(s.responses).every(rows => rows.length === 0) && !s.presentation && !s.game && !s.prediction && Object.keys(s.questionnaire).length === 0, 'No research responses before consent');
    if (s.stage === 'T0')
        insist(!s.game && !s.prediction, 'Gameplay cannot precede completed T0');
    if (Object.values(s.responses).some(rows => rows.length) || s.game)
        insist(s.consent?.agreed === true && s.consent?.eligible === true && s.consent?.adult === true, 'Research data require prior consent');
    const ix = exports.STAGES.indexOf(s.stage);
    if (ix >= 2)
        insist(s.responses.T0.length === 8, 'T0 incomplete');
    if (ix >= 5)
        insist(s.responses.T1.length === 8, 'T1 incomplete');
    if (ix >= 7)
        insist(s.responses.T2.length === 8, 'T2 incomplete');
    if (ix < 4 && s.stage !== 'WITHDRAWN')
        insist(s.responses.T1.length === 0, 'Premature T1 data');
    if (ix < 6 && s.stage !== 'WITHDRAWN')
        insist(s.responses.T2.length === 0, 'Premature T2 data');
    if (s.presentation) {
        insist(['T0', 'T1', 'T2'].includes(s.stage) && s.presentation.block === s.stage, 'Invalid item presentation');
        insist(s.presentation.caseId === (0, cases_mjs_1.getCases)(formFor(s, s.stage))[s.responses[s.stage].length]?.id && validDate(s.presentation.presentedAt), 'Wrong presented item');
    }
    if (ix >= 3)
        insist(s.game?.canonicalState?.phase === 'MINI_MIRROR', 'Missing completed canonical game');
    if (s.game)
        validateGameSnapshot({ ...s, game: null }, s.game);
    if (ix >= 4 || s.responses.T1.length || s.responses.T2.length || s.prediction) {
        const p = s.prediction;
        insist(p && s.predictionReceipt?.predictionSha256 && validDate(s.predictionReceipt.committedAt), 'Missing committed prediction');
        insist(predictionCommitted !== false, 'Server prediction not committed');
        insist(p.participantId === s.participantId && p.sessionId === s.sessionId && p.studyVersion === s.studyVersion && p.coreHash === s.coreGame.buildHash, 'Prediction identity mismatch');
        insist(p.form === formFor(s, 'T1') && validDate(p.timestamp), 'Prediction form/timestamp mismatch');
        insist(Array.isArray(p.predictions) && p.predictions.length === 8 && p.modelState, 'Incomplete prediction payload');
        p.predictions.forEach((r, i) => {
            insist(r.caseId === (0, cases_mjs_1.getCases)(p.form)[i].id, 'Wrong prediction case');
            for (const m of ['M0', 'M1', 'M2', 'M3'])
                insist(Number.isFinite(r[m]?.predictedScore) && r[m].predictedScore >= 0 && r[m].predictedScore <= 100, 'Invalid prediction score');
        });
        // Browser and server clocks need not agree. The server's durable journal and
        // this append-only event order, not a cross-clock timestamp comparison, gate T1.
        const commitEvent = s.events.find(e => e.type === 'PREDICTION_COMMITTED');
        const firstT1 = s.events.find(e => e.type === 'ITEM_PRESENTED' && e.block === 'T1');
        insist(commitEvent, 'Prediction commit event missing');
        if (firstT1)
            insist(firstT1.seq > commitEvent.seq, 'T1 presentation precedes prediction commitment');
    }
    return true;
}
// Collector calls this against its saved checkpoint; a client cannot rewind or rewrite a trial.
function validateStudyTransition(previous, next, options = {}) {
    validateStudyState(next, options);
    if (!previous)
        return true;
    for (const field of ['schema', 'studyVersion', 'coreGame', 'consentVersion', 'participantId', 'sessionId', 'assignment'])
        insist(eq(previous[field], next[field]), `Immutable field changed: ${field}`);
    if (previous.consent)
        insist(eq(previous.consent, next.consent), 'Consent changed');
    for (const b of ['T0', 'T1', 'T2'])
        insist(eq(previous.responses[b], next.responses[b].slice(0, previous.responses[b].length)), 'A saved response changed');
    insist(eq(previous.events, next.events.slice(0, previous.events.length)), 'Audit history changed');
    insist(eq(previous.technicalErrors, next.technicalErrors.slice(0, previous.technicalErrors.length)), 'Error history changed');
    if (previous.prediction)
        insist(eq(previous.prediction, next.prediction) && eq(previous.predictionReceipt, next.predictionReceipt), 'Prediction lock changed');
    if (previous.game && next.game)
        validateGameSnapshot(previous, next.game);
    const a = exports.STAGES.indexOf(previous.stage), b = exports.STAGES.indexOf(next.stage);
    if (next.stage !== 'WITHDRAWN')
        insist(previous.stage !== 'WITHDRAWN' && b >= a && b <= a + 1, 'Illegal study transition');
    if (previous.stage === 'COMPLETE')
        insist(next.stage === 'COMPLETE', 'Completed session reopened');
    return true;
}

}],
"pilot/consent-validator.mjs": [{}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSENT_CONFIRMATIONS = void 0;
exports.validateConsentSubmission = validateConsentSubmission;
exports.consentRecordIsComplete = consentRecordIsComplete;
// Authoritative consent validator shared by the UI, the study transition and the collectors.
// Every confirmation must be the boolean `true`; nothing is coerced, defaulted or inferred.
exports.CONSENT_CONFIRMATIONS = Object.freeze(['adult', 'english', 'informed', 'agreed']);
const HEX64 = /^[a-f0-9]{64}$/;
function validateConsentSubmission(input, { researcherConfigSha256, consentTextSha256 } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('CONSENT_OBJECT_REQUIRED');
    const allowed = new Set([...exports.CONSENT_CONFIRMATIONS, 'eligible', 'researcherConfigSha256', 'consentTextSha256', 'ethicsReference', 'studyTitle']);
    for (const key of Object.keys(input))
        if (!allowed.has(key))
            throw new Error(`CONSENT_UNKNOWN_FIELD:${key}`);
    for (const key of exports.CONSENT_CONFIRMATIONS) {
        if (!(key in input) || input[key] === undefined)
            throw new Error(`CONSENT_CONFIRMATION_MISSING:${key}`);
        if (typeof input[key] !== 'boolean')
            throw new Error(`CONSENT_CONFIRMATION_NOT_BOOLEAN:${key}`);
        if (input[key] !== true)
            throw new Error(`CONSENT_CONFIRMATION_NOT_TRUE:${key}`);
    }
    if ('eligible' in input && input.eligible !== true)
        throw new Error('CONSENT_CONFIRMATION_NOT_TRUE:eligible');
    if (!HEX64.test(input.researcherConfigSha256 || ''))
        throw new Error('CONSENT_CONFIG_HASH_REQUIRED');
    if (!HEX64.test(input.consentTextSha256 || ''))
        throw new Error('CONSENT_TEXT_HASH_REQUIRED');
    if (researcherConfigSha256 && input.researcherConfigSha256 !== researcherConfigSha256)
        throw new Error('CONSENT_CONFIG_MISMATCH');
    if (consentTextSha256 && input.consentTextSha256 !== consentTextSha256)
        throw new Error('CONSENT_CONFIG_MISMATCH');
    if (input.ethicsReference != null && (typeof input.ethicsReference !== 'string' || input.ethicsReference.length > 200))
        throw new Error('CONSENT_INVALID_ETHICS_REFERENCE');
    if (input.studyTitle != null && (typeof input.studyTitle !== 'string' || input.studyTitle.length > 300))
        throw new Error('CONSENT_INVALID_STUDY_TITLE');
    return { adult: true, english: true, informed: true, agreed: true, eligible: true,
        researcherConfigSha256: input.researcherConfigSha256, consentTextSha256: input.consentTextSha256,
        ethicsReference: input.ethicsReference ?? null, studyTitle: input.studyTitle ?? null };
}
/** True only when a stored consent object carries every confirmation as boolean true. */
function consentRecordIsComplete(consent) {
    return !!consent && typeof consent === 'object' && [...exports.CONSENT_CONFIRMATIONS, 'eligible'].every((k) => consent[k] === true)
        && HEX64.test(consent.researcherConfigSha256 || '') && HEX64.test(consent.consentTextSha256 || '') && typeof consent.at === 'string';
}

}],
"pilot/cases.mjs": [{}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORMS = exports.BLOCK_INSTRUCTIONS = exports.VOTE_PROMPT = exports.JUDGMENT_PROMPT = exports.DIMENSIONS = exports.CASE_BANK_VERSION = void 0;
exports.getCases = getCases;
exports.getCase = getCase;
// Additive study materials. No world/engine/content constants are changed here.
// Numeric features are preregistered design codes, NOT known probabilities of guilt.
exports.CASE_BANK_VERSION = 'pm-parallel-cases/1.0.0';
exports.DIMENSIONS = Object.freeze([
    'evidenceSensitivity', 'partisanSymmetry', 'crowdSusceptibility', 'deniabilitySusceptibility',
]);
exports.JUDGMENT_PROMPT = 'How likely is it that the official deliberately misused their public position in the way alleged?';
exports.VOTE_PROMPT = 'If these were your only two options, would you retain this official or replace them with an otherwise comparable candidate?';
exports.BLOCK_INSTRUCTIONS = 'All people, parties, places and events below are fictional. Judge each case separately using only the information provided. The cases concern different officials. Enter a probability from 0 (certain it did not happen) to 100 (certain it happened), then make a retain-or-replace choice. There is no answer key for these judgments.';
const FEATURE_ROWS = [
    ['E_LOW', 'evidenceSensitivity', 'LOW', { evidence: 0.20, partisan: 0, crowd: 0, deniability: 0 }],
    ['P_OWN', 'partisanSymmetry', 'PLAYER_SIDE', { evidence: 0.45, partisan: -0.5, crowd: 0, deniability: 0 }],
    ['C_HIGH', 'crowdSusceptibility', 'CROWD_HIGH', { evidence: 0.45, partisan: 0, crowd: 0.5, deniability: 0 }],
    ['D_HIGH', 'deniabilitySusceptibility', 'DEN_HIGH', { evidence: 0.45, partisan: 0, crowd: 0, deniability: 0.5 }],
    ['E_HIGH', 'evidenceSensitivity', 'HIGH', { evidence: 0.70, partisan: 0, crowd: 0, deniability: 0 }],
    ['P_OPP', 'partisanSymmetry', 'OPPOSING_SIDE', { evidence: 0.45, partisan: 0.5, crowd: 0, deniability: 0 }],
    ['C_LOW', 'crowdSusceptibility', 'CROWD_LOW', { evidence: 0.45, partisan: 0, crowd: -0.5, deniability: 0 }],
    ['D_LOW', 'deniabilitySusceptibility', 'DEN_LOW', { evidence: 0.45, partisan: 0, crowd: 0, deniability: -0.5 }],
];
const TEXTS = {
    A: [
        ['The delivery van', 'Councillor Lena Voss is accused of using a city delivery van to move stock for her private furniture shop. An anonymous online post says a van was seen near the shop. The photograph is blurred, the number plate cannot be read, and no journey record has been obtained. Voss denies arranging any private deliveries. No party affiliation or public reaction is reported.'],
        ['The festival stall', 'Imagine that Councillor Ravi Sen belongs to the political party whose policies you generally prefer. Sen is accused of moving a campaign volunteer ahead of other applicants for a city festival stall. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Sen says an eligibility review explains the change. No review record or additional evidence is available.'],
        ['The evening hall booking', 'Councillor Mara Cole is accused of arranging free use of the town hall for a friend’s private ticketed talk. A booking entry lists Cole as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Cole denies arranging free access. Thousands of people have reposted this same entry with angry comments; none provides new evidence. No party affiliation is reported.'],
        ['The overtime memo', 'A scanned memo appears to show Councillor Joel Ward directing paid city staff to prepare campaign leaflets. If authentic, the instruction would be a misuse of public resources. Ward says his signature was copied onto a draft he never approved. Only a forwarded scan is available, and the original has not been located or independently authenticated. No party affiliation or public reaction is reported.'],
        ['The printing order', 'Councillor Tessa Reed is accused of using the city printing service for her private art sale. An independently checked order record identifies Reed, specifies the private sale flyers, and charges the job to the city. In a verified message, Reed acknowledges knowingly using the city account for this personal expense. No party affiliation or public reaction is reported.'],
        ['The market stall', 'Imagine that Councillor Owen Park belongs to the political party whose policies you generally oppose. Park is accused of moving a campaign volunteer ahead of other applicants for a city market stall. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Park says an eligibility review explains the change. No review record or additional evidence is available.'],
        ['The afternoon hall booking', 'Councillor Nia Bell is accused of arranging free use of the town hall for a friend’s private ticketed lecture. A booking entry lists Bell as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Bell denies arranging free access. A local reporter has filed the entry, but there has been no public circulation or reaction. No party affiliation is reported.'],
        ['The staffing memo', 'A signed memo appears to show Councillor Evan Moss directing paid city staff to prepare campaign posters. If authentic, the instruction would be a misuse of public resources. Moss says his signature was copied onto a draft he never approved. The original is available, and two independent document examiners confirm the signature and find no alterations. No party affiliation or public reaction is reported.'],
    ],
    B: [
        ['The surveying kit', 'Councillor Iris Dale is accused of taking city surveying equipment for work on her private orchard. An anonymous online post says equipment was seen near the orchard. The photograph is blurred, the equipment label cannot be read, and no checkout record has been obtained. Dale denies arranging any private use. No party affiliation or public reaction is reported.'],
        ['The west marina berth', 'Imagine that Councillor Amir Lake belongs to the political party whose policies you generally prefer. Lake is accused of moving a campaign volunteer ahead of other applicants for a city marina berth. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Lake says an eligibility review explains the change. No review record or additional evidence is available.'],
        ['The morning pool lane', 'Councillor Rosa Finch is accused of arranging free use of a municipal pool lane for a friend’s private paid coaching. A booking entry lists Finch as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Finch denies arranging free access. Thousands of people have reposted this same entry with angry comments; none provides new evidence. No party affiliation is reported.'],
        ['The mailing instruction', 'A scanned instruction appears to show Councillor Milo Stone directing paid city staff to send campaign mailings. If authentic, the instruction would be a misuse of public resources. Stone says his signature was copied onto a draft he never approved. Only a forwarded scan is available, and the original has not been located or independently authenticated. No party affiliation or public reaction is reported.'],
        ['The translation order', 'Councillor Anya Frost is accused of using the city translation service for her private cookbook. An independently checked order record identifies Frost, specifies the private cookbook text, and charges the job to the city. In a verified message, Frost acknowledges knowingly using the city account for this personal expense. No party affiliation or public reaction is reported.'],
        ['The east marina berth', 'Imagine that Councillor Leo Brook belongs to the political party whose policies you generally oppose. Brook is accused of moving a campaign volunteer ahead of other applicants for a city marina berth. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Brook says an eligibility review explains the change. No review record or additional evidence is available.'],
        ['The evening pool lane', 'Councillor Hana Wells is accused of arranging free use of a municipal pool lane for a friend’s private paid training. A booking entry lists Wells as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Wells denies arranging free access. A local reporter has filed the entry, but there has been no public circulation or reaction. No party affiliation is reported.'],
        ['The call-list instruction', 'A signed instruction appears to show Councillor Noah Field directing paid city staff to make campaign calls. If authentic, the instruction would be a misuse of public resources. Field says his signature was copied onto a draft he never approved. The original is available, and two independent document examiners confirm the signature and find no alterations. No party affiliation or public reaction is reported.'],
    ],
    C: [
        ['The recording studio', 'Councillor Ada Marsh is accused of using the city recording studio for her private advertising business. An anonymous online post says she was seen near the studio. The photograph is blurred, the entrance sign cannot be read, and no booking record has been obtained. Marsh denies arranging any private sessions. No party affiliation or public reaction is reported.'],
        ['The north parking space', 'Imagine that Councillor Sami Glen belongs to the political party whose policies you generally prefer. Glen is accused of moving a campaign volunteer ahead of other applicants for a city overnight parking space. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Glen says an eligibility review explains the change. No review record or additional evidence is available.'],
        ['The first telescope booking', 'Councillor Clara Pine is accused of arranging free use of a municipal telescope for a friend’s private paid tour. A booking entry lists Pine as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. Pine denies arranging free access. Thousands of people have reposted this same entry with angry comments; none provides new evidence. No party affiliation is reported.'],
        ['The dispatch instruction', 'A scanned instruction appears to show Councillor Theo Vale directing paid city staff to deliver campaign newsletters. If authentic, the instruction would be a misuse of public resources. Vale says his signature was copied onto a draft he never approved. Only a forwarded scan is available, and the original has not been located or independently authenticated. No party affiliation or public reaction is reported.'],
        ['The storage order', 'Councillor Mira Hart is accused of using the city warehouse for her private catering stock. An independently checked order record identifies Hart, specifies the private business supplies, and charges storage to the city. In a verified message, Hart acknowledges knowingly using the city account for this personal expense. No party affiliation or public reaction is reported.'],
        ['The south parking space', 'Imagine that Councillor Luca Birch belongs to the political party whose policies you generally oppose. Birch is accused of moving a campaign volunteer ahead of other applicants for a city overnight parking space. A dated waiting list shows the volunteer moved from eighth to first, but the reason field is blank. Birch says an eligibility review explains the change. No review record or additional evidence is available.'],
        ['The second telescope booking', 'Councillor Esme West is accused of arranging free use of a municipal telescope for a friend’s private paid visit. A booking entry lists West as the contact but leaves the payment field blank. It is unclear whether an invoice was issued separately. West denies arranging free access. A local reporter has filed the entry, but there has been no public circulation or reaction. No party affiliation is reported.'],
        ['The packing instruction', 'A signed instruction appears to show Councillor Finn Grove directing paid city staff to pack campaign welcome letters. If authentic, the instruction would be a misuse of public resources. Grove says his signature was copied onto a draft he never approved. The original is available, and two independent document examiners confirm the signature and find no alterations. No party affiliation or public reaction is reported.'],
    ],
};
function freezeDeep(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freezeDeep);
        Object.freeze(value);
    }
    return value;
}
exports.FORMS = freezeDeep(Object.fromEntries(Object.entries(TEXTS).map(([form, rows]) => [form,
    rows.map(([title, text], index) => {
        const [slot, dimension, level, features] = FEATURE_ROWS[index];
        return { id: `${form}_${slot}`, caseId: `${form}_${slot}`, form, slot, dimension,
            pairId: `${form}_${dimension}`, level, title, text, features: { ...features },
            prompt: exports.JUDGMENT_PROMPT, votePrompt: exports.VOTE_PROMPT, caseBankVersion: exports.CASE_BANK_VERSION };
    }),
])));
function getCases(form) {
    if (!Object.hasOwn(exports.FORMS, form))
        throw new Error(`Unknown parallel form: ${form}`);
    return exports.FORMS[form];
}
function getCase(caseId) {
    for (const rows of Object.values(exports.FORMS)) {
        const item = rows.find((row) => row.id === caseId);
        if (item)
            return item;
    }
    throw new Error(`Unknown voter-judgment case: ${caseId}`);
}

}],
"pilot/rebuild.mjs": [{"../src/game-session.mjs":"src/game-session.mjs","./prediction.mjs":"pilot/prediction.mjs","./study.mjs":"pilot/study.mjs","./actor-context.mjs":"pilot/actor-context.mjs","./assignment.mjs":"pilot/assignment.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildCommittedPredictionWith = rebuildCommittedPredictionWith;
// Server-side regeneration of a committed prediction (shared by the Node collector and the
// Cloudflare Worker). One frozen-engine replay both verifies the canonical state/hash and
// projects the actor-only M3 context; then the exact same fixed models are rebuilt.
const game_session_mjs_1 = require("../src/game-session.mjs");
const prediction_mjs_1 = require("./prediction.mjs");
const study_mjs_1 = require("./study.mjs");
const actor_context_mjs_1 = require("./actor-context.mjs");
const assignment_mjs_1 = require("./assignment.mjs");
function rebuildCommittedPredictionWith(state, prediction, buildInfo) {
    (0, study_mjs_1.validateStudyState)(state);
    if (state.stage !== 'PREDICTION' || state.responses.T1.length || state.responses.T2.length)
        throw new Error('Predictions can only be committed before the first T1 item');
    if (state.coreGame.buildHash !== buildInfo.buildHash || state.coreGame.sourceManifestHash !== buildInfo.sourceManifestHash)
        throw new Error('Frozen build identity mismatch');
    const g = state.game;
    const { context, session: replayed } = (0, actor_context_mjs_1.extractPublicDecisionContext)(g.spec, g.transcript, { returnSession: true });
    for (const [i, entry] of g.transcript.entries())
        if (entry.hash && replayed.actionTranscript?.[i] && replayed.actionTranscript[i].hash !== entry.hash)
            throw new Error('Saved game fails exact frozen-engine replay');
    const canonical = (0, game_session_mjs_1.serializeCanonicalState)(replayed);
    if (replayed.phase !== 'MINI_MIRROR' || (0, assignment_mjs_1.stableJSON)(canonical) !== (0, assignment_mjs_1.stableJSON)(g.canonicalState) || (0, game_session_mjs_1.hashCanonicalState)(replayed) !== g.canonicalHash)
        throw new Error('Saved game fails exact frozen-engine replay');
    return (0, prediction_mjs_1.buildPredictionCommit)({ participantId: state.participantId, sessionId: state.sessionId, coreState: canonical, gameLog: g.telemetry,
        t0: state.responses.T0, form: state.assignment.formOrder[1], studyVersion: state.studyVersion, coreHash: state.coreGame.buildHash,
        timestamp: prediction.timestamp, actorContext: context });
}

}],
"src/game-session.mjs": [{"./engine.mjs":"src/engine.mjs","./abilities.mjs":"src/abilities.mjs","./election.mjs":"src/election.mjs","./content.mjs":"src/content.mjs","./playtest.mjs":"src/playtest.mjs"}, function(module, exports, require) {
"use strict";
// Political Mirror v0.37.2 — one canonical political life.
//
// This module is the only owner of gameplay progression. Browser code renders the
// current interaction and dispatches actions; headless code chooses actions from the
// same interaction. No consumer evaluates beat.when, skips a beat, fires an event, or
// applies a public choice independently.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameSessionError = exports.ACTIONS = exports.PHASES = exports.SESSION_CONFIG = void 0;
exports.resolveCanonicalSeed = resolveCanonicalSeed;
exports.buildWorld = buildWorld;
exports.previewStartingProfile = previewStartingProfile;
exports.createGameSession = createGameSession;
exports.advanceToNextInteraction = advanceToNextInteraction;
exports.dispatchGameAction = dispatchGameAction;
exports.buildMirror = buildMirror;
exports.getCurrentInteraction = getCurrentInteraction;
exports.stableStringify = stableStringify;
exports.hashText = hashText;
exports.voterStateDigest = voterStateDigest;
exports.serializeCanonicalState = serializeCanonicalState;
exports.hashCanonicalState = hashCanonicalState;
exports.replayActionTranscript = replayActionTranscript;
exports.getSessionResults = getSessionResults;
exports.runCounterfactualAudit = runCounterfactualAudit;
const engine_mjs_1 = require("./engine.mjs");
const AB = __importStar(require("./abilities.mjs"));
const EL = __importStar(require("./election.mjs"));
const content_mjs_1 = require("./content.mjs");
const playtest_mjs_1 = require("./playtest.mjs");
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
exports.SESSION_CONFIG = Object.freeze({
    id: 'pm-session-config',
    version: '0.37.2',
    startAge: 23,
    agentCount: 700,
    hashActions: true,
    liabilityThreshold: 2.4,
    reckoningFundsDrain: 0.12,
    reckoningStandingDrain: 0.12,
});
exports.PHASES = Object.freeze({
    TITLE: 'TITLE',
    STORY_CHOICE: 'STORY_CHOICE',
    PRIVATE_READ: 'PRIVATE_READ',
    PUBLIC_MOVE: 'PUBLIC_MOVE',
    REACTION: 'REACTION',
    CHAIN_RETURN: 'CHAIN_RETURN',
    DEVELOPMENT_FOCUS: 'DEVELOPMENT_FOCUS',
    DEVELOPMENT_RESULT: 'DEVELOPMENT_RESULT',
    WILDERNESS_CHOICE: 'WILDERNESS_CHOICE',
    WILDERNESS_RESULT: 'WILDERNESS_RESULT',
    ELECTION_RESULT: 'ELECTION_RESULT',
    CAREER_SUMMARY: 'CAREER_SUMMARY',
    MINI_MIRROR: 'MINI_MIRROR',
});
exports.ACTIONS = Object.freeze({
    START_GAME: 'START_GAME',
    SUBMIT_PRIVATE_READ: 'SUBMIT_PRIVATE_READ',
    SELECT_PUBLIC_MOVE: 'SELECT_PUBLIC_MOVE',
    SELECT_WILDERNESS_ROUTE: 'SELECT_WILDERNESS_ROUTE',
    SELECT_DEVELOPMENT_FOCUS: 'SELECT_DEVELOPMENT_FOCUS',
    CONTINUE_REACTION: 'CONTINUE_REACTION',
    CONTINUE_CHAIN: 'CONTINUE_CHAIN',
    CONTINUE_ELECTION: 'CONTINUE_ELECTION',
    CONTINUE_DEVELOPMENT_RESULT: 'CONTINUE_DEVELOPMENT_RESULT',
    CONTINUE_WILDERNESS: 'CONTINUE_WILDERNESS',
    VIEW_MIRROR: 'VIEW_MIRROR',
});
class GameSessionError extends Error {
    constructor(message, code = 'INVALID_ACTION') {
        super(message);
        this.name = 'GameSessionError';
        this.code = code;
    }
}
exports.GameSessionError = GameSessionError;
const DEFAULT_PLAYER = Object.freeze({
    name: 'A. Reyes', bloc: 'CIV', region: 'Harrow Vale', route: 'CIVIC',
});
function clonePlain(value) {
    if (value === undefined)
        return undefined;
    return structuredClone(value);
}
function finite(value, label) {
    if (!Number.isFinite(value))
        throw new GameSessionError(`${label} must be finite`, 'INVALID_CONFIG');
    return value;
}
function resolveCanonicalSeed(seed, testMode) {
    const mode = (0, playtest_mjs_1.resolveTestMode)(testMode);
    const forced = mode ? playtest_mjs_1.PLAYTEST_SEEDS[mode].seed : null;
    return String(forced || seed || 'POL-M7GX4').trim().toUpperCase() || 'POL-M7GX4';
}
function buildWorld(seed, player, agentCount = exports.SESSION_CONFIG.agentCount, config = exports.SESSION_CONFIG) {
    const route = content_mjs_1.ROUTES.find((candidate) => candidate.id === player.route);
    if (!route)
        throw new GameSessionError(`unknown background route: ${player.route}`, 'INVALID_CONFIG');
    const root = (0, engine_mjs_1.seedFromString)(seed);
    return {
        root,
        route,
        n: finite(agentCount, 'agentCount'),
        worldSeed: (0, engine_mjs_1.deriveSeed)(root, 'world'),
        eventSeed: (0, engine_mjs_1.deriveSeed)(root, 'events'),
        actorSeed: (0, engine_mjs_1.deriveSeed)(root, 'actors'),
        playerBloc: player.bloc,
        rivalBloc: (0, content_mjs_1.OPP)(player.bloc),
        startMu: route.start.mu,
        startTau: route.start.tau,
        startAge: config.startAge,
    };
}
function previewStartingProfile({ seed = 'POL-M7GX4', player = DEFAULT_PLAYER, testMode = null } = {}) {
    const canonicalPlayer = { ...DEFAULT_PLAYER, ...player };
    const canonicalSeed = resolveCanonicalSeed(seed, testMode);
    const world = buildWorld(canonicalSeed, canonicalPlayer, exports.SESSION_CONFIG.agentCount, exports.SESSION_CONFIG);
    return AB.makeAbilities((0, engine_mjs_1.makeRng)((0, engine_mjs_1.deriveSeed)(world.worldSeed, 'abilities')), canonicalPlayer.route);
}
function createGameSession({ seed = 'POL-M7GX4', player = DEFAULT_PLAYER, agentCount = exports.SESSION_CONFIG.agentCount, testMode = null, config = {}, } = {}) {
    const mergedConfig = Object.freeze({ ...exports.SESSION_CONFIG, ...config, startAge: 23 });
    const canonicalPlayer = { ...DEFAULT_PLAYER, ...player };
    if (!['CIV', 'REN'].includes(canonicalPlayer.bloc))
        throw new GameSessionError(`unknown political bloc: ${canonicalPlayer.bloc}`, 'INVALID_CONFIG');
    if (!Number.isInteger(agentCount) || agentCount <= 0)
        throw new GameSessionError('agentCount must be a positive integer', 'INVALID_CONFIG');
    return {
        sessionVersion: '0.37.2',
        config: mergedConfig,
        requestedSeed: String(seed || ''),
        seed: resolveCanonicalSeed(seed, testMode),
        testMode: (0, playtest_mjs_1.resolveTestMode)(testMode),
        player: canonicalPlayer,
        agentCount,
        phase: exports.PHASES.TITLE,
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
        tape: (0, engine_mjs_1.makeTape)(),
        st: null,
        pending: {},
        resumeAfterDevelopment: null,
        beatTrace: [],
        eventTrace: [],
        elections: [],
        actionIndex: 0,
        lastAction: null,
        actionTranscript: [],
        mirror: null,
    };
}
function currentBeat(session) {
    return session.script[session.beatIndex] || null;
}
function requireStarted(session) {
    if (!session.started || !session.st)
        throw new GameSessionError('game has not started', 'NOT_STARTED');
}
function initWorld(session) {
    const world = buildWorld(session.seed, session.player, session.agentCount, session.config);
    const { agents, wr, tilt } = (0, engine_mjs_1.buildInitialWorld)(world);
    const actorRng = (0, engine_mjs_1.makeRng)(world.actorSeed);
    // Consume the world stream exactly once, here. Every consumer inherits this order.
    const tipTrue = wr.float() < 0.42;
    world.errorFound = wr.float() < 0.45;
    world.leakTraced = wr.float() < 0.38;
    const rival = EL.rollRival(wr);
    const start = world.route.start;
    const abilities = AB.makeAbilities((0, engine_mjs_1.makeRng)((0, engine_mjs_1.deriveSeed)(world.worldSeed, 'abilities')), world.route.id);
    session.world = world;
    session.agents = agents;
    session.worldRng = wr;
    session.actorRng = actorRng;
    session.eventRng = (0, engine_mjs_1.makeRng)(world.eventSeed);
    session.rivalArc = rival.arc;
    session.rivalProfile = rival.profile;
    session.rivalPush = rival.push;
    session.tape = (0, engine_mjs_1.makeTape)();
    session.script = (0, content_mjs_1.SCRIPT)(session.player);
    session.beatIndex = 0;
    session.currentBeatId = null;
    session.st = {
        abilities,
        age: session.config.startAge,
        office: null,
        recognition: 0.50,
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
        tilt,
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
        nextPhase: null,
    };
    session.beatTrace.push(entry);
    return entry;
}
function activeTrace(session) {
    for (let i = session.beatTrace.length - 1; i >= 0; i--) {
        if (session.beatTrace[i].beatIndex === session.beatIndex)
            return session.beatTrace[i];
    }
    return null;
}
function fireEvent(session, event, age, seedActor = null, label = null) {
    const full = { ...event, __age: age, __seedActor: seedActor, __label: label };
    if (seedActor)
        (0, engine_mjs_1.seedBeliefs)(session.agents, event.actorId, seedActor[0], seedActor[1], session.actorRng);
    (0, engine_mjs_1.tapeEvent)(session.tape, full);
    const reaction = (0, engine_mjs_1.applyEvent)(session.agents, event, session.eventRng, session.player.bloc);
    const record = {
        index: session.eventTrace.length,
        beatId: currentBeat(session)?.id || null,
        age,
        actorId: event.actorId,
        trait: event.trait || 'integrity',
        implication: event.implication,
        label,
    };
    session.eventTrace.push(record);
    session.st.reactions.push({ ...record, delta: reaction.delta });
    const trace = activeTrace(session);
    if (trace)
        trace.eventsFired.push(record.index);
    return reaction;
}
function advanceAgeTo(session, age) {
    if (age < session.st.age)
        throw new GameSessionError(`age cannot move backward (${session.st.age} -> ${age})`, 'AGE_REGRESSION');
    if (age > session.st.age) {
        const years = age - session.st.age;
        (0, engine_mjs_1.ageElectorate)(session.agents, years);
        (0, engine_mjs_1.tapeAge)(session.tape, age, years, `age ${session.st.age} to ${age}`, 'timeline');
        session.st.age = age;
    }
    while (session.rivalArc.length && session.rivalArc[0].age <= session.st.age) {
        const arc = session.rivalArc.shift();
        for (const actorId of ['RIVAL1', 'RIVAL2']) {
            fireEvent(session, {
                actorId,
                implication: arc.implication,
                strength: 0.9,
                reliability: 0.9,
                diagnosticity: 0.8,
                deniability: 0,
                trait: arc.trait,
                targetSide: 'OPPOSING_SIDE',
                sourceAlignment: 'NEUTRAL',
                crowd: null,
                mediaReach: 0.95,
            }, arc.age, null, `rival ${arc.trait} arc`);
        }
    }
}
function finishBeat(session) {
    const trace = activeTrace(session);
    if (trace)
        trace.nextPhase = 'ADVANCE';
    session.beatIndex += 1;
    session.currentBeatId = null;
    session.pending = {};
    session.resumeAfterDevelopment = null;
    return advanceToNextInteraction(session);
}
function scheduleDevelopment(session, grant, resume) {
    AB.grantPoints(session.st.abilities, grant.n, grant.reason);
    session.pending.developmentGrant = clonePlain(grant);
    session.pending.developmentResult = null;
    session.resumeAfterDevelopment = resume;
    session.phase = exports.PHASES.DEVELOPMENT_FOCUS;
}
function resolveElection(session, beat) {
    if (beat.tier === 2 && !session.st.flags.RECKONED) {
        session.st.flags.RECKONED = true;
        const reckoning = (0, engine_mjs_1.liabilityReckoning)(session.st.liability || 0, session.config.liabilityThreshold);
        if (reckoning) {
            session.st.reckoning = reckoning.magnitude;
            session.st.funds = Math.max(0, Math.round(session.st.funds
                * (1 - session.config.reckoningFundsDrain * reckoning.magnitude)));
            session.st.standing = Math.max(0, Math.round(session.st.standing
                * (1 - session.config.reckoningStandingDrain * reckoning.magnitude)));
            fireEvent(session, { actorId: 'PLAYER', ...reckoning.signal }, beat.age, null, 'The pattern');
        }
    }
    const electionWorld = {
        rivalPush: session.rivalPush,
        rivalProfileId: session.rivalProfile.id,
        playerBloc: session.player.bloc,
        rivalBloc: (0, content_mjs_1.OPP)(session.player.bloc),
        seedFor: (label) => (0, engine_mjs_1.deriveSeed)(session.world.root, label),
    };
    const { spec, res, won } = EL.holdElection(session.agents, session.st, beat, electionWorld, engine_mjs_1.makeRng);
    (0, engine_mjs_1.tapeElection)(session.tape, spec);
    session.st.office = won ? beat.office : null;
    const result = {
        age: beat.age,
        office: beat.office,
        won,
        share: res.shares.PLAYER,
        turnout: res.turnout,
        approval: (0, engine_mjs_1.approvalOf)(session.agents, 'PLAYER'),
        winner: res.winner,
        tally: clonePlain(res.tally),
        shares: clonePlain(res.shares),
        spec: clonePlain(spec),
    };
    session.elections.push(result);
    session.st.history.push({
        age: beat.age, kind: 'election', office: beat.office, won,
        share: result.share, turnout: result.turnout, approval: result.approval,
    });
    session.pending.election = result;
    if (beat.tier === 1) {
        const campaign = won ? content_mjs_1.CAMPAIGN_XP.WON : content_mjs_1.CAMPAIGN_XP.LOST;
        AB.addExperience(session.st.abilities, campaign.tags, campaign.label);
        scheduleDevelopment(session, content_mjs_1.DP_GRANTS.FIRST_CAMPAIGN, { type: 'PHASE', phase: exports.PHASES.ELECTION_RESULT });
    }
    else {
        session.phase = exports.PHASES.ELECTION_RESULT;
    }
}
function resolveChain(session, beat) {
    const spec = content_mjs_1.CHAINS[beat.chain];
    const read = session.st.log.find((entry) => entry.kind === 'read' && entry.eventId === spec.seedId);
    const move = session.st.log.find((entry) => entry.kind === 'move' && entry.eventId === spec.seedId);
    if (!read && !move)
        return false;
    const verdict = (0, engine_mjs_1.chainVerdict)(spec.outcome, read ? read.credence : null, move);
    session.st.chains[beat.chain] = {
        ...verdict,
        seedId: spec.seedId,
        credence: read?.credence ?? null,
        choiceId: move?.choiceId ?? null,
    };
    const text = content_mjs_1.CHAIN_TEXT[beat.chain](verdict);
    let reaction = null;
    if (verdict.signal) {
        reaction = fireEvent(session, { actorId: 'PLAYER', ...verdict.signal }, beat.age, null, `the ${beat.chain.toLowerCase()} file resurfacing`);
    }
    session.pending.chain = {
        chain: beat.chain,
        ...text,
        verdictData: verdict,
        recall: (0, content_mjs_1.chainRecall)(spec, read ? read.credence : null, move),
        said: read ? content_mjs_1.LADDER[0][read.credence] : null,
        did: move?.label ?? null,
        seedTitle: read?.title || move?.title || null,
        reaction,
    };
    session.phase = exports.PHASES.CHAIN_RETURN;
    return true;
}
function resolveWilderness(session, beat) {
    const route = session.st.out;
    if (!route)
        return false;
    session.st.lastOutRoute = route.route;
    session.st.wildYears += 2;
    if (route.fade > 0) {
        (0, engine_mjs_1.ageElectorate)(session.agents, route.fade);
        (0, engine_mjs_1.tapeAge)(session.tape, beat.age, route.fade, `${route.route} wilderness fade`);
    }
    if (route.local)
        session.st.capital += 2;
    if (route.route === 'STAFF')
        session.st.standing += 2;
    if (route.route === 'PROFESSIONAL')
        session.st.funds += 3;
    if (route.route === 'MEDIA') {
        session.st.recognition = clamp(session.st.recognition + 0.08, 0, 1);
        session.st.flags.IMAGE_HARDENED = true;
    }
    const payoff = content_mjs_1.WILDERNESS_PAYOFF[route.route];
    const reaction = payoff ? fireEvent(session, {
        actorId: 'PLAYER', ...payoff, deniability: 0,
        targetSide: 'PLAYER_SIDE', sourceAlignment: 'NEUTRAL', crowd: null,
    }, beat.age, null, 'your four years out') : null;
    AB.addExperience(session.st.abilities, route.route === 'MEDIA' ? ['COMM'] : route.route === 'STAFF' ? ['NEG']
        : route.route === 'LOCAL' ? ['ORG'] : ['STRAT'], 'Four years out of office');
    session.st.history.push({ age: beat.age, kind: 'wilderness', route: route.route });
    session.pending.wilderness = {
        route: route.route,
        text: content_mjs_1.WILDERNESS_TEXT[route.route],
        note: route.note,
        fade: route.fade,
        reaction,
    };
    scheduleDevelopment(session, content_mjs_1.DP_GRANTS.WILDERNESS, { type: 'PHASE', phase: exports.PHASES.WILDERNESS_RESULT });
    return true;
}
function setPresentedPhase(session, trace, phase) {
    session.phase = phase;
    trace.nextPhase = phase;
    if (phase === exports.PHASES.PRIVATE_READ)
        trace.privateReadPresented = true;
    if ([exports.PHASES.PUBLIC_MOVE, exports.PHASES.STORY_CHOICE, exports.PHASES.WILDERNESS_CHOICE].includes(phase)) {
        trace.publicMovePresented = true;
        trace.presentedChoices = (currentBeat(session)?.choices || []).map((choice) => ({
            id: choice.id, ...choiceStatus(session, choice),
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
            trace.nextPhase = 'SKIPPED';
            session.beatIndex += 1;
            session.currentBeatId = null;
            continue;
        }
        advanceAgeTo(session, beat.age);
        if (beat.kind === 'election') {
            resolveElection(session, beat);
            trace.nextPhase = session.phase;
            return getCurrentInteraction(session);
        }
        if (beat.kind === 'milestone') {
            if (beat.grant && !session.st.flags[`MS_${beat.id}`]) {
                session.st.flags[`MS_${beat.id}`] = true;
                session.st.history.push({ age: beat.age, kind: 'milestone', id: beat.id });
                scheduleDevelopment(session, content_mjs_1.DP_GRANTS[beat.grant], { type: 'ADVANCE' });
                trace.nextPhase = session.phase;
                return getCurrentInteraction(session);
            }
            trace.nextPhase = 'AUTO_ADVANCE';
            session.beatIndex += 1;
            session.currentBeatId = null;
            continue;
        }
        if (beat.kind === 'wilderness') {
            if (resolveWilderness(session, beat)) {
                trace.nextPhase = session.phase;
                return getCurrentInteraction(session);
            }
            trace.nextPhase = 'AUTO_ADVANCE';
            session.beatIndex += 1;
            session.currentBeatId = null;
            continue;
        }
        if (beat.kind === 'chain') {
            if (resolveChain(session, beat)) {
                trace.nextPhase = session.phase;
                return getCurrentInteraction(session);
            }
            trace.nextPhase = 'AUTO_ADVANCE';
            session.beatIndex += 1;
            session.currentBeatId = null;
            continue;
        }
        if (beat.kind === 'consequence') {
            const resolution = beat.resolve(session.st);
            const reaction = fireEvent(session, { actorId: 'PLAYER', ...resolution.event }, beat.age, null, beat.title);
            session.st.history.push({ age: beat.age, kind: 'consequence', title: beat.title });
            session.pending.reaction = { text: resolution.text, reaction, title: beat.title };
            return setPresentedPhase(session, trace, exports.PHASES.REACTION);
        }
        if (beat.kind === 'fallout') {
            const hard = Boolean(session.st.flags.TIP_ATTACK);
            const implication = session.st.tipTrue ? (hard ? 0.35 : 0.18) : (hard ? -0.8 : -0.45);
            session.st.flags.TIP_BACKFIRED = !session.st.tipTrue;
            const reaction = fireEvent(session, {
                actorId: 'PLAYER', implication, strength: 0.8, reliability: 0.9,
                diagnosticity: 0.7, deniability: 0, trait: 'integrity',
                targetSide: 'PLAYER_SIDE', sourceAlignment: implication < 0 ? 'OPPOSED' : 'ALIGNED',
                crowd: null, mediaReach: 0.9, salience: 0.4,
            }, beat.age, null, 'the folder you used');
            session.pending.reaction = {
                title: beat.title || 'The folder returns',
                text: session.st.tipTrue
                    ? 'The foundation story holds up. Two reporters confirm the transfers independently, and the material you used turns out to have been true.'
                    : 'The foundation story collapses eight days before the vote. The transfers were routine and documented, and the correction runs beside a photograph of you making the claim.',
                reaction,
            };
            return setPresentedPhase(session, trace, exports.PHASES.REACTION);
        }
        if (beat.playerAllegation) {
            session.pending.allegationReaction = fireEvent(session, { actorId: 'PLAYER', ...beat.playerAllegation }, beat.age, null, beat.title);
        }
        if (beat.kind === 'judgment')
            return setPresentedPhase(session, trace, exports.PHASES.PRIVATE_READ);
        const phase = beat.id === 'WILDERNESS' ? exports.PHASES.WILDERNESS_CHOICE : exports.PHASES.STORY_CHOICE;
        return setPresentedPhase(session, trace, phase);
    }
    session.phase = exports.PHASES.CAREER_SUMMARY;
    session.currentBeatId = null;
    session.pending = {};
    return getCurrentInteraction(session);
}
function validateBeatAction(session, action) {
    const beat = currentBeat(session);
    if (!beat)
        throw new GameSessionError('there is no active beat', 'INVALID_BEAT');
    if (!action.beatId)
        throw new GameSessionError(`${action.type} requires beatId`, 'INVALID_BEAT');
    if (action.beatId !== beat.id) {
        throw new GameSessionError(`${action.type} targets beat ${action.beatId}, but current beat is ${beat.id}`, 'INVALID_BEAT');
    }
    return beat;
}
function choiceStatus(session, choice) {
    if (!AB.meets(session.st.abilities, choice.requires)) {
        return { ok: false, reason: AB.unmetReason(session.st.abilities, choice.requires), kind: 'ABILITY' };
    }
    const resource = (0, engine_mjs_1.choiceAvailability)(choice, session.st);
    return resource.ok ? { ok: true } : { ...resource, kind: 'RESOURCE' };
}
function applyPublicChoice(session, beat, choice) {
    const status = choiceStatus(session, choice);
    if (!status.ok)
        throw new GameSessionError(`choice ${choice.id} is locked: ${status.reason}`, 'LOCKED_CHOICE');
    session.st.log.push({
        kind: 'move', eventId: beat.id, title: beat.title, label: choice.label,
        choiceId: choice.id, features: clonePlain(choice.features),
        responsibility: Boolean(beat.responsibility),
        institutional: Boolean(choice.institutional || beat.institutional),
        temptation: Boolean(beat.temptation),
    });
    session.st.liability += (0, engine_mjs_1.choiceLiability)(choice.features);
    (0, engine_mjs_1.payCost)(choice, session.st);
    if (choice.out) {
        session.st.out = clonePlain(choice.out);
        session.st.recognition = clamp(session.st.recognition + choice.out.recognition, 0, 1);
        session.st.independence = clamp(session.st.independence + choice.out.independence, 0, 1);
    }
    if (choice.career) {
        session.st.recognition = clamp(session.st.recognition + (choice.career.recognition || 0), 0, 1);
        session.st.independence = clamp(session.st.independence + (choice.career.independence || 0), 0, 1);
    }
    for (const [key, value] of Object.entries(choice.effect || {}))
        session.st[key] = Math.max(0, (session.st[key] || 0) + value);
    if (choice.flag)
        session.st.flags[choice.flag] = true;
    if (choice.flag === 'COMEBACK_RUN' || choice.flag === 'COMEBACK_DECLINE')
        session.st.out = null;
    if (choice.flag === 'COMEBACK_RUN') {
        session.st.office = 'Ward Council';
        session.st.flags.CAME_BACK = true;
    }
    if (beat.flag)
        session.st.flags[beat.flag] = true;
    let execution = null;
    if (choice.check) {
        execution = AB.check(session.st.abilities, choice.check.ability, choice.check.dc, (0, engine_mjs_1.makeRng)((0, engine_mjs_1.deriveSeed)(session.world.worldSeed, `exec:${beat.id}:${choice.id}`)), { pressure: beat.pressure || 0 });
        session.st.execs.push({
            beat: beat.id, choiceId: choice.id, ability: choice.check.ability,
            value: session.st.abilities.value[choice.check.ability], grade: execution.grade,
        });
    }
    AB.addExperience(session.st.abilities, choice.xp || content_mjs_1.XP_TAGS[beat.id] || [], beat.title);
    let reaction = null;
    if (choice.signal) {
        reaction = fireEvent(session, {
            actorId: 'PLAYER', reliability: 0.9, diagnosticity: 0.65, deniability: 0,
            targetSide: 'PLAYER_SIDE', sourceAlignment: 'NEUTRAL', crowd: null,
            mediaReach: session.st.office ? 0.8 : 0.5, ...choice.signal, stakes: choice.stakes,
        }, beat.age, null, beat.title);
    }
    const executionScale = execution ? execution.scale : 1;
    for (const signal of (0, engine_mjs_1.actionSignals)(choice.features, {
        scrutiny: session.st.office ? 0.85 : 0.45,
        salience: beat.salience ?? (session.st.office ? 0.45 : 0.3),
        stakes: choice.stakes,
    })) {
        reaction = fireEvent(session, {
            actorId: 'PLAYER', ...signal,
            implication: clamp(signal.implication * executionScale, -1, 1),
        }, beat.age, null, beat.title);
    }
    if (execution && execution.grade !== 'solid') {
        const implication = { excellent: 0.42, poor: -0.30, botched: -0.55 }[execution.grade];
        reaction = fireEvent(session, {
            actorId: 'PLAYER', implication, strength: 0.6, reliability: 0.9,
            diagnosticity: 0.6, deniability: 0, trait: 'competence',
            targetSide: 'PLAYER_SIDE', sourceAlignment: 'NEUTRAL', crowd: null,
            mediaReach: session.st.office ? 0.7 : 0.45,
        }, beat.age, null, `${beat.title} (execution)`);
    }
    if ((choice.features?.transparency || 0) + (choice.features?.exploitation || 0) > 0.25) {
        session.st.recognition = clamp(session.st.recognition
            + AB.recognitionGain(session.st.abilities, 0.012), 0, 1);
    }
    if (choice.hitsRival) {
        fireEvent(session, {
            actorId: beat.age >= 33 ? 'RIVAL2' : 'RIVAL1', implication: -choice.hitsRival,
            strength: 0.7, reliability: 0.65, diagnosticity: 0.7, deniability: 0.3,
            trait: 'integrity', targetSide: 'OPPOSING_SIDE', sourceAlignment: 'ALIGNED',
            crowd: null, mediaReach: 0.85,
        }, beat.age, null, beat.title);
    }
    session.st.history.push({
        age: beat.age, kind: 'choice', id: beat.id, title: beat.title,
        choiceId: choice.id, label: choice.label,
    });
    const strategyNote = choice.strategyRead
        ? (session.st.tipTrue
            ? 'Your analyst works through the night. “The paperwork stands up. Two of these transfers are real and I can show you why.”'
            : 'Your analyst works through the night. “There is nothing underneath this. Somebody assembled it to look like something.”')
        : null;
    session.pending.reaction = reaction || strategyNote || execution
        ? { title: beat.title, reaction, execution: clonePlain(execution), strategyNote }
        : null;
    if (beat.id === 'PARTY_OFFER' && !session.st.flags.MIDCAREER_DP) {
        session.st.flags.MIDCAREER_DP = true;
        scheduleDevelopment(session, content_mjs_1.DP_GRANTS.MIDCAREER, session.pending.reaction
            ? { type: 'PHASE', phase: exports.PHASES.REACTION }
            : { type: 'ADVANCE' });
        return;
    }
    if (session.pending.reaction)
        session.phase = exports.PHASES.REACTION;
    else
        finishBeat(session);
}
function submitRead(session, action) {
    const beat = validateBeatAction(session, action);
    if (!Number.isInteger(action.credence) || action.credence < 0 || action.credence > 3)
        throw new GameSessionError('credence must be an integer from 0 to 3', 'INVALID_PAYLOAD');
    session.st.log.push({
        kind: 'read', eventId: beat.id, title: beat.title, pairId: beat.pairId,
        factor: beat.factor, level: beat.level, credence: action.credence,
        chainSeed: beat.chainSeed, ...clonePlain(beat.latents),
    });
    fireEvent(session, { actorId: `OTHER_${beat.id}`, ...beat.latents }, beat.age, [0.5, 1.1], beat.title);
    session.phase = exports.PHASES.PUBLIC_MOVE;
    const trace = activeTrace(session);
    if (trace) {
        trace.publicMovePresented = true;
        trace.presentedChoices = (beat.choices || []).map((choice) => ({
            id: choice.id, ...choiceStatus(session, choice),
        }));
        trace.nextPhase = exports.PHASES.PUBLIC_MOVE;
    }
}
function chooseMove(session, action, expectedPhase) {
    const beat = validateBeatAction(session, action);
    if (session.phase !== expectedPhase)
        throw new GameSessionError(`${action.type} is invalid during ${session.phase}`, 'WRONG_PHASE');
    const choice = beat.choices?.find((candidate) => candidate.id === action.choiceId);
    if (!choice)
        throw new GameSessionError(`unknown choice ${action.choiceId} for ${beat.id}`, 'INVALID_CHOICE');
    applyPublicChoice(session, beat, choice);
}
function selectDevelopment(session, action) {
    validateBeatAction(session, action);
    if (!AB.ABILITY_IDS.includes(action.primary) || !AB.ABILITY_IDS.includes(action.secondary))
        throw new GameSessionError('development focus requires two valid ability ids', 'INVALID_PAYLOAD');
    if (action.primary === action.secondary)
        throw new GameSessionError('primary and secondary development focuses must differ', 'INVALID_PAYLOAD');
    const grant = session.pending.developmentGrant;
    const before = { ...session.st.abilities.value };
    const result = AB.applyFocus(session.st.abilities, action.primary, action.secondary, grant.n);
    session.st.abilities.dp = 0;
    const record = {
        reason: grant.reason,
        budget: grant.n,
        primary: action.primary,
        secondary: action.secondary,
        before,
        after: { ...session.st.abilities.value },
        result: clonePlain(result),
        gained: (result.primary?.gained || 0) + (result.secondary?.gained || 0),
    };
    session.st.focusLog.push(record);
    session.pending.developmentResult = record;
    session.phase = exports.PHASES.DEVELOPMENT_RESULT;
}
function resumeAfterDevelopment(session) {
    const resume = session.resumeAfterDevelopment;
    session.resumeAfterDevelopment = null;
    session.pending.developmentGrant = null;
    session.pending.developmentResult = null;
    if (resume?.type === 'PHASE') {
        session.phase = resume.phase;
        return;
    }
    finishBeat(session);
}
function assertPhase(session, expected, action) {
    if (session.phase !== expected)
        throw new GameSessionError(`${action.type} is invalid during ${session.phase}; expected ${expected}`, 'WRONG_PHASE');
}
function canonicalAction(action) {
    const copy = {};
    for (const key of Object.keys(action).sort())
        copy[key] = clonePlain(action[key]);
    return copy;
}
function dispatchGameAction(session, action) {
    if (!action || typeof action.type !== 'string')
        throw new GameSessionError('action.type is required', 'INVALID_ACTION');
    if (session.complete)
        throw new GameSessionError('session is already complete', 'POST_COMPLETION');
    const phaseBefore = session.phase;
    switch (action.type) {
        case exports.ACTIONS.START_GAME:
            if (session.started)
                throw new GameSessionError('START_GAME may only be submitted once', 'DUPLICATE_ACTION');
            assertPhase(session, exports.PHASES.TITLE, action);
            initWorld(session);
            advanceToNextInteraction(session);
            break;
        case exports.ACTIONS.SUBMIT_PRIVATE_READ:
            assertPhase(session, exports.PHASES.PRIVATE_READ, action);
            submitRead(session, action);
            break;
        case exports.ACTIONS.SELECT_PUBLIC_MOVE:
            if (![exports.PHASES.PUBLIC_MOVE, exports.PHASES.STORY_CHOICE].includes(session.phase))
                throw new GameSessionError(`${action.type} is invalid during ${session.phase}`, 'WRONG_PHASE');
            chooseMove(session, action, session.phase);
            break;
        case exports.ACTIONS.SELECT_WILDERNESS_ROUTE:
            chooseMove(session, action, exports.PHASES.WILDERNESS_CHOICE);
            break;
        case exports.ACTIONS.SELECT_DEVELOPMENT_FOCUS:
            assertPhase(session, exports.PHASES.DEVELOPMENT_FOCUS, action);
            selectDevelopment(session, action);
            break;
        case exports.ACTIONS.CONTINUE_DEVELOPMENT_RESULT:
            assertPhase(session, exports.PHASES.DEVELOPMENT_RESULT, action);
            validateBeatAction(session, action);
            resumeAfterDevelopment(session);
            break;
        case exports.ACTIONS.CONTINUE_REACTION:
            assertPhase(session, exports.PHASES.REACTION, action);
            validateBeatAction(session, action);
            finishBeat(session);
            break;
        case exports.ACTIONS.CONTINUE_CHAIN:
            assertPhase(session, exports.PHASES.CHAIN_RETURN, action);
            validateBeatAction(session, action);
            finishBeat(session);
            break;
        case exports.ACTIONS.CONTINUE_ELECTION:
            assertPhase(session, exports.PHASES.ELECTION_RESULT, action);
            validateBeatAction(session, action);
            finishBeat(session);
            break;
        case exports.ACTIONS.CONTINUE_WILDERNESS:
            assertPhase(session, exports.PHASES.WILDERNESS_RESULT, action);
            validateBeatAction(session, action);
            finishBeat(session);
            break;
        case exports.ACTIONS.VIEW_MIRROR:
            assertPhase(session, exports.PHASES.CAREER_SUMMARY, action);
            session.mirror = buildMirror(session);
            session.phase = exports.PHASES.MINI_MIRROR;
            session.complete = true;
            break;
        default:
            throw new GameSessionError(`unknown action type: ${action.type}`, 'UNKNOWN_ACTION');
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
        hash,
    };
    session.actionTranscript.push(record);
    return record;
}
function beatView(beat) {
    if (!beat)
        return null;
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
        office: beat.office || null,
    };
}
function choiceView(session, choice) {
    return {
        id: choice.id,
        label: choice.label,
        requires: clonePlain(choice.requires || null),
        cost: clonePlain(choice.cost || null),
        availability: choiceStatus(session, choice),
    };
}
function buildMirror(session) {
    requireStarted(session);
    const analysis = (0, engine_mjs_1.analysePlayer)(session.st.log);
    const resolution = (0, engine_mjs_1.mirrorResolution)(analysis, session.st.log);
    return {
        analysis,
        resolution,
        cross: (0, engine_mjs_1.crossMirror)(analysis, session.st.log),
        checklist: (0, engine_mjs_1.checklist)(analysis),
        inputs: {
            reads: clonePlain(session.st.log.filter((entry) => entry.kind === 'read')),
            moves: clonePlain(session.st.log.filter((entry) => entry.kind === 'move')),
        },
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
            belief: (0, engine_mjs_1.meanBelief)(session.agents, 'PLAYER'),
            approval: (0, engine_mjs_1.approvalOf)(session.agents, 'PLAYER'),
            precision: (0, engine_mjs_1.meanPrecision)(session.agents, 'PLAYER'),
        } : null,
    };
    if (beat?.choices && [exports.PHASES.STORY_CHOICE, exports.PHASES.PUBLIC_MOVE,
        exports.PHASES.WILDERNESS_CHOICE].includes(session.phase)) {
        base.choices = beat.choices.map((choice) => choiceView(session, choice));
    }
    if (session.phase === exports.PHASES.PRIVATE_READ)
        base.ladder = clonePlain(content_mjs_1.LADDER[beat.readFormat ?? 0]);
    if (session.phase === exports.PHASES.REACTION)
        base.reaction = clonePlain(session.pending.reaction);
    if (session.phase === exports.PHASES.CHAIN_RETURN)
        base.chain = clonePlain(session.pending.chain);
    if (session.phase === exports.PHASES.ELECTION_RESULT)
        base.election = clonePlain(session.pending.election);
    if (session.phase === exports.PHASES.WILDERNESS_RESULT)
        base.wilderness = clonePlain(session.pending.wilderness);
    if (session.phase === exports.PHASES.DEVELOPMENT_FOCUS) {
        base.development = {
            grant: clonePlain(session.pending.developmentGrant),
            focuses: content_mjs_1.LIFE_FOCUS.map((focus) => clonePlain(focus)),
        };
    }
    if (session.phase === exports.PHASES.DEVELOPMENT_RESULT)
        base.development = { result: clonePlain(session.pending.developmentResult) };
    if (session.phase === exports.PHASES.CAREER_SUMMARY) {
        base.summary = {
            elections: clonePlain(session.elections),
            chains: clonePlain(session.st.chains),
            moves: session.st.log.filter((entry) => entry.kind === 'move').length,
            reads: session.st.log.filter((entry) => entry.kind === 'read').length,
        };
    }
    if (session.phase === exports.PHASES.MINI_MIRROR)
        base.mirror = clonePlain(session.mirror);
    return base;
}
function normalized(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new GameSessionError('canonical state contains a non-finite number', 'INVALID_STATE');
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value))
        return value.map(normalized);
    if (typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] !== undefined && typeof value[key] !== 'function')
                out[key] = normalized(value[key]);
        }
        return out;
    }
    return String(value);
}
function stableStringify(value) {
    return JSON.stringify(normalized(value));
}
function hashText(text) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        hash ^= BigInt(code & 0xff);
        hash = BigInt.asUintN(64, hash * prime);
        hash ^= BigInt(code >>> 8);
        hash = BigInt.asUintN(64, hash * prime);
    }
    return hash.toString(16).padStart(16, '0');
}
function voterStateDigest(session) {
    if (!session.agents)
        return null;
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
        beliefs: agent.beliefs,
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
            leakTraced: session.world.leakTraced,
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
            events: session.eventRng.state(),
        } : null,
        tape: session.tape,
        mirror: session.mirror,
        voterStateDigest: voterStateDigest(session),
    });
}
function hashCanonicalState(session) {
    return hashText(stableStringify(serializeCanonicalState(session)));
}
function replayActionTranscript(options, transcript) {
    const session = createGameSession(options);
    for (const entry of transcript) {
        const action = entry.action || entry;
        const record = dispatchGameAction(session, action);
        if (entry.hash && entry.hash !== record.hash) {
            throw new GameSessionError(`parity divergence at action ${record.index} (${action.type}): expected ${entry.hash}, got ${record.hash}`, 'PARITY_DIVERGENCE');
        }
    }
    return session;
}
function getSessionResults(session) {
    requireStarted(session);
    const mirror = session.mirror || buildMirror(session);
    return {
        st: session.st,
        agents: session.agents,
        world: session.world,
        tape: session.tape,
        analysis: mirror.analysis,
        res: mirror.resolution,
        cross: mirror.cross,
        list: mirror.checklist,
        belief: (0, engine_mjs_1.meanBelief)(session.agents, 'PLAYER'),
        prec: (0, engine_mjs_1.meanPrecision)(session.agents, 'PLAYER'),
        approval: (0, engine_mjs_1.approvalOf)(session.agents, 'PLAYER'),
        session,
    };
}
function runCounterfactualAudit(session) {
    requireStarted(session);
    return (0, engine_mjs_1.counterfactualAudit)(session.tape, session.world);
}

}],
"src/engine.mjs": [{"./det-math.mjs":"src/det-math.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CF_MOMENT_BAND = exports.CF_BAND = exports.CF_CONDITIONS = exports.CRED_LABEL = exports.STAKE_GAIN = exports.BLOC_LABELS = exports.FAMILY_LABEL = exports.FAMILIES = exports.PARAMS = exports.sigmoid = exports.q6 = void 0;
exports.seedFromString = seedFromString;
exports.makeRng = makeRng;
exports.deriveSeed = deriveSeed;
exports.updateBelief = updateBelief;
exports.ageBelief = ageBelief;
exports.makeElectorate = makeElectorate;
exports.seedBeliefs = seedBeliefs;
exports.blocsOf = blocsOf;
exports.applyEvent = applyEvent;
exports.actionSignals = actionSignals;
exports.choiceLiability = choiceLiability;
exports.liabilityReckoning = liabilityReckoning;
exports.chainVerdict = chainVerdict;
exports.meanBeliefWhere = meanBeliefWhere;
exports.meanBelief = meanBelief;
exports.meanPrecision = meanPrecision;
exports.approvalOf = approvalOf;
exports.ageElectorate = ageElectorate;
exports.runElection = runElection;
exports.analysePlayer = analysePlayer;
exports.mirrorResolution = mirrorResolution;
exports.crossMirror = crossMirror;
exports.checklist = checklist;
exports.makeTape = makeTape;
exports.tapeEvent = tapeEvent;
exports.tapeElection = tapeElection;
exports.tapeAge = tapeAge;
exports.buildInitialWorld = buildInitialWorld;
exports.replayCareer = replayCareer;
exports.counterfactualAudit = counterfactualAudit;
exports.choiceAvailability = choiceAvailability;
exports.payCost = payCost;
// Political Mirror — vertical slice engine
// Pure. No DOM, no React, no Date.now(). Testable in Node, inlined into the artifact by build.mjs.
// Transcendentals come from det-math.mjs: Math.exp/log/tanh/** are engine-defined in their
// last bit and broke browser/headless hash parity (v0.37.2, action 27 of POL-M7GX4).
const det_math_mjs_1 = require("./det-math.mjs");
// ─────────────────────────────── RNG ───────────────────────────────
// xoshiro128** with splitmix32 seeding. Integer state, serialisable.
const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
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
        z = (z + 0x9e3779b9) >>> 0;
        let t = z;
        t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0;
        t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
        return (t ^ (t >>> 16)) >>> 0;
    };
    let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
    const next = () => {
        const r = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
        const t = (s1 << 9) >>> 0;
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
        next, float,
        range: (a, b) => a + float() * (b - a),
        int: (n) => next() % n,
        // Irwin-Hall normal: pure arithmetic, no transcendentals, fully deterministic.
        normal: () => { let s = 0; for (let i = 0; i < 12; i++)
            s += float(); return s - 6; },
        gumbel: () => -(0, det_math_mjs_1.detLog)(-(0, det_math_mjs_1.detLog)(float() + 1e-12) + 1e-12),
        state: () => [s0, s1, s2, s3],
        setState: (st) => { s0 = st[0] >>> 0; s1 = st[1] >>> 0; s2 = st[2] >>> 0; s3 = st[3] >>> 0; },
    };
}
// Derive an independent stream per subsystem. Never share a stream.
function deriveSeed(root, label) {
    return (seedFromString(label) ^ Math.imul(root >>> 0, 0x9e3779b9)) >>> 0;
}
// Quantise before any threshold comparison (ADR 002).
const q6 = (x) => Math.round(x * 1e6) / 1e6;
exports.q6 = q6;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const sigmoid = (z) => 1 / (1 + (0, det_math_mjs_1.detExp)(-z));
exports.sigmoid = sigmoid;
// ───────────────────────── Belief representation ─────────────────────────
// Gaussian in logit space with explicit precision. Formulation F1:
// severity sets WHAT the evidence says; strength/reliability/diagnosticity/deniability
// set HOW MUCH to trust it. Nothing appears in both.
exports.PARAMS = {
    X_MAX: 3.0, // logit location of a maximal-implication event
    KAPPA: 0.63, // observation precision scale (calibrated)
    TAU_FLOOR: 0.35,
    TAU_CEIL: 5.0,
    Q_VOLATILITY: 0.022, // process noise per year
    CROWD_LOC: 0.5,
    KAPPA_CROWD: 0.30,
    D_SENS_NORM: 0.7, // normative deniability discount
};
function updateBelief(belief, xEvent, tauObs) {
    const tau = belief.tau;
    const K = tauObs / (tau + tauObs);
    return {
        mu: clamp(belief.mu + K * (xEvent - belief.mu), -6, 6),
        tau: clamp(tau + tauObs, exports.PARAMS.TAU_FLOOR, exports.PARAMS.TAU_CEIL),
    };
}
// Precision decays with time: people forget, and politicians change.
// This is what makes newcomers volatile, veterans teflon, and comebacks possible.
function ageBelief(belief, years) {
    const inv = 1 / belief.tau + exports.PARAMS.Q_VOLATILITY * years;
    const pull = Math.min(0.10, 0.012 * years); // slow drift toward the population reference
    return { mu: belief.mu * (1 - pull), tau: clamp(1 / inv, exports.PARAMS.TAU_FLOOR, exports.PARAMS.TAU_CEIL) };
}
// ───────────────────────────── Voter agents ─────────────────────────────
exports.FAMILIES = ['A', 'B', 'C', 'D'];
exports.FAMILY_LABEL = {
    A: 'Weighs the evidence',
    B: 'Rejects inconvenient evidence',
    C: 'Accepts it, discounts what it means',
    D: 'Distrusts the messenger',
};
// A is the plurality by design; D smallest because it is the rival explanation.
const FAMILY_MIX = [['A', 0.35], ['B', 0.25], ['C', 0.22], ['D', 0.18]];
function drawFamily(u) {
    let acc = 0;
    for (const [f, p] of FAMILY_MIX) {
        acc += p;
        if ((0, exports.q6)(u) < (0, exports.q6)(acc))
            return f;
    }
    return 'D';
}
function makeElectorate(rng, n, blocOfPlayer, blocOfRival = 'OPP', tilt = 0) {
    // tilt < 0 : this world's electorate mostly wants someone honest
    // tilt > 0 : this world's electorate mostly wants someone who delivers
    const agents = new Array(n);
    for (let i = 0; i < n; i++) {
        const lean = clamp(rng.normal() * 0.55, -1, 1);
        const interest = clamp(0.5 + rng.normal() * 0.22, 0.05, 1);
        const fam = drawFamily(rng.float());
        const biasDraw = () => clamp(Math.abs(rng.normal()) * 1.1 + 0.25 * interest, 0, 4);
        agents[i] = {
            id: i,
            lean, // −1 opposing bloc … +1 player's bloc
            side: lean > 0.15 ? blocOfPlayer : lean < -0.15 ? blocOfRival : 'IND',
            ideology: clamp(rng.normal() * 0.5, -1, 1),
            interest,
            mediaTrust: clamp(0.55 + rng.normal() * 0.2, 0.05, 1),
            instTrust: clamp(0.55 + rng.normal() * 0.2, 0.05, 1),
            turnoutBase: clamp(0.45 + interest * 0.4 + rng.normal() * 0.12, 0.02, 0.98),
            crowdSens: clamp(0.4 + rng.normal() * 0.28, 0, 1),
            denialSens: clamp(0.6 + rng.normal() * 0.25, 0, 1),
            // What this voter is actually shopping for. Anti-correlated: nobody weights
            // everything equally, and the population's centre of gravity varies by world.
            wInt: clamp(1.5 - tilt + rng.normal() * 0.62, 0.15, 3.0),
            wComp: clamp(1.5 + tilt + rng.normal() * 0.62, 0.15, 3.0),
            family: fam,
            gateBias: fam === 'B' ? biasDraw() : 0,
            motivBias: fam === 'C' ? clamp(biasDraw() / 2.2, 0, 0.95) : 0,
            srcBias: fam === 'D' ? clamp(biasDraw() / 2.2, 0, 0.95) : 0,
            // Who this voter is in policy terms: what they stand to gain or lose. Used only to
            // make the same decision land differently on different people. Never a targetable
            // segment, and never used to optimise persuasion.
            owner: rng.float() < 0.46,
            young: rng.float() < 0.34,
            publicSector: rng.float() < 0.22,
            business: rng.float() < 0.18,
            beliefs: {},
        };
    }
    return agents;
}
function seedBeliefs(agents, actorId, muBase, tauBase, rng) {
    for (const a of agents) {
        a.beliefs[actorId] = {
            integrity: { mu: muBase + rng.normal() * 0.4, tau: clamp(tauBase + rng.normal() * 0.15, 0.25, 5) },
            competence: { mu: muBase * 0.7 + rng.normal() * 0.4, tau: clamp(tauBase + rng.normal() * 0.15, 0.25, 5) },
        };
    }
}
// Identity variables — explicit and non-negative. No signed "congruence" anywhere.
function identityVars(agent, ev, playerBloc) {
    const targetSide = ev.targetSide; // 'PLAYER_SIDE' | 'OPPOSING_SIDE' | 'NON_PARTISAN'
    const agentWithPlayerBloc = agent.side === playerBloc;
    const incriminating = ev.implication < 0;
    let ownSideThreat = 0, outgroupTarget = 0;
    if (targetSide !== 'NON_PARTISAN' && agent.side !== 'IND') {
        const targetIsAgentsSide = (targetSide === 'PLAYER_SIDE' && agentWithPlayerBloc) ||
            (targetSide === 'OPPOSING_SIDE' && !agentWithPlayerBloc);
        if (incriminating) {
            if (targetIsAgentsSide)
                ownSideThreat = 1;
            else
                outgroupTarget = 1;
        }
    }
    // NOTE: interest already gates exposure. Multiplying by it again here double-counts
    // and crushes every identity effect to near-zero.
    const identityStakes = clamp(Math.abs(agent.lean) * 1.25, 0, 1);
    let sourceAlignment = 0.5;
    if (ev.sourceAlignment === 'ALIGNED')
        sourceAlignment = agentWithPlayerBloc ? 0.85 : 0.15;
    else if (ev.sourceAlignment === 'OPPOSED')
        sourceAlignment = agentWithPlayerBloc ? 0.15 : 0.85;
    return { ownSideThreat, outgroupTarget, identityStakes, sourceAlignment };
}
// Apply one event to the electorate. Returns what the UI needs to show a reaction.
exports.BLOC_LABELS = {
    core: 'Core supporters', ind: 'Independent voters', opp: 'Opposition voters',
    owner: 'Homeowners', young: 'Younger renters', publicSector: 'Public-sector staff',
    business: 'Local business',
};
function blocsOf(a, playerBloc) {
    const out = [a.side === playerBloc ? 'core' : a.side === 'IND' ? 'ind' : 'opp'];
    if (a.owner)
        out.push('owner');
    if (a.young)
        out.push('young');
    if (a.publicSector)
        out.push('publicSector');
    if (a.business)
        out.push('business');
    return out;
}
// How a voter's own stake shifts what an event means to them. A housing reform reads as
// competence to a renter and as a threat to an owner, from the same set of facts. This is
// the whole mechanism behind "different people wanted different things".
// People who personally lose from a decision react to that loss far more strongly than
// the general public reacts to the decision looking principled. Without this gain the
// integrity signal of a clean choice swamps the anger of the people it costs, and the
// trade-off collapses into "doing the right thing is just better".
exports.STAKE_GAIN = 1.9;
function stakeShift(a, ev, playerBloc) {
    const s = ev.stakes;
    if (!s)
        return 0;
    let v = 0;
    for (const k of ['owner', 'young', 'publicSector', 'business'])
        if (a[k] && s[k])
            v += s[k];
    v += a.side === playerBloc ? (s.core || 0) : a.side === 'IND' ? (s.ind || 0) : (s.opp || 0);
    return v * exports.STAKE_GAIN;
}
function applyEvent(agents, ev, rng, playerBloc, opts = {}) {
    const trait = ev.trait || 'integrity';
    const before = meanBelief(agents, ev.actorId, trait);
    const byFamily = { A: 0, B: 0, C: 0, D: 0 };
    const byBloc = {};
    const blocN = {};
    const famN = { A: 0, B: 0, C: 0, D: 0 };
    const bySide = {};
    const sideN = {};
    let exposed = 0, admitted = 0;
    const baseImpl = ev.implication;
    const suppress = opts.suppress || {}; // for counterfactual replay
    for (const a of agents) {
        const b = a.beliefs[ev.actorId];
        if (!b)
            continue;
        const b0 = b[trait].mu;
        const iv = identityVars(a, ev, playerBloc);
        // Exposure
        const pExp = clamp(a.interest * (ev.mediaReach ?? 0.8) * (1 + (ev.salience ?? 0)), 0, 1);
        if ((0, exports.q6)(rng.float()) >= (0, exports.q6)(pExp)) {
            accum(a, 0);
            continue;
        }
        exposed++;
        // Perceived reliability — Model A discounts by media trust, identity-independently.
        let rel = ev.reliability * (0.55 + 0.45 * a.mediaTrust);
        let diag = ev.diagnosticity;
        let admit = true;
        // Draw unconditionally so the RNG stream stays aligned across counterfactual
        // conditions — otherwise suppression shifts every later draw and the measured
        // "difference" is partly noise rather than mechanism.
        const gateDraw = rng.float();
        if (a.family === 'B') {
            const z = -0.2 + 2.6 * ev.reliability + 1.4 * (1 - ev.deniability) + 0.9 * (iv.sourceAlignment - 0.5)
                - (suppress.gate ? 0 : a.gateBias * iv.ownSideThreat * iv.identityStakes)
                + (suppress.gate ? 0 : 0.5 * a.gateBias * iv.outgroupTarget * iv.identityStakes);
            admit = (0, exports.q6)(gateDraw) < (0, exports.q6)((0, exports.sigmoid)(z));
        }
        if (a.family === 'C' && !suppress.motiv) {
            diag = clamp(diag * (1 - a.motivBias * iv.ownSideThreat * iv.identityStakes)
                * (1 + 0.5 * a.motivBias * iv.outgroupTarget * iv.identityStakes), 0, 1);
        }
        if (a.family === 'D' && !suppress.source) {
            rel = clamp(rel * (1 - a.srcBias * iv.ownSideThreat * iv.identityStakes * (1 - iv.sourceAlignment)), 0, 1);
        }
        if (!admit) {
            accum(a, 0);
            continue;
        }
        admitted++;
        // Deniability reduces effective reliability. The normative discount is NOT zero.
        const dSens = suppress.deniability ? 0 : (exports.PARAMS.D_SENS_NORM * 0.5 + a.denialSens * 0.5);
        const relEff = rel * (1 - ev.deniability * dSens);
        const tauObs = exports.PARAMS.KAPPA * ev.strength * relEff * diag;
        const implForAgent = clamp(baseImpl + stakeShift(a, ev, playerBloc), -1, 1);
        b[trait] = updateBelief(b[trait], exports.PARAMS.X_MAX * implForAgent, tauObs);
        // Crowd is a separate, weak, correlated channel — not a modifier on the evidence.
        if (ev.crowd && !suppress.crowd) {
            const indep = ev.crowd.independence ?? 0.25;
            const tauCrowd = exports.PARAMS.KAPPA_CROWD * ev.crowd.magnitude * a.crowdSens * indep;
            const xCrowd = exports.PARAMS.X_MAX * ev.crowd.direction * ev.crowd.magnitude * exports.PARAMS.CROWD_LOC;
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
    for (const f of exports.FAMILIES)
        fam[f] = famN[f] ? byFamily[f] / famN[f] : 0;
    const sides = {};
    for (const k of Object.keys(bySide))
        sides[k] = bySide[k] / sideN[k];
    return {
        before, after, delta: after - before,
        exposedPct: exposed / agents.length,
        admittedPct: exposed ? admitted / exposed : 0,
        byFamily: fam, bySide: sides,
        byBloc: Object.fromEntries(Object.keys(byBloc).map((k) => [k, byBloc[k] / (blocN[k] || 1)])),
        blocN,
    };
}
// Every public action is itself evidence about the actor — on TWO traits, not one.
// Integrity and competence pull in opposite directions for some choices, which is
// what stops "be principled" from being a dominant strategy.
function actionSignals(features, ctx = {}) {
    const f = features || {};
    const scrutiny = ctx.scrutiny ?? 0.6;
    const salience = ctx.salience ?? 0; // how loudly the public is already watching
    const integrity = clamp(0.55 * (f.transparency || 0) + 0.50 * (f.concession || 0) + 0.30 * (f.proceduralRestraint || 0)
        - 0.60 * (f.exploitation || 0) - 0.45 * (f.deflection || 0) - 0.45 * (f.selfProtection || 0)
        - 0.40 * (f.institutionalCost || 0), -1, 1);
    // Decisiveness. Under a watching public, "wait for the process" reads as weakness,
    // and acting hard reads as strength — regardless of whether it was right.
    const decisive = 0.70 * (f.exploitation || 0) + 0.50 * (f.electoralGain > 0 ? f.electoralGain : 0)
        + 0.35 * (f.concession || 0) + 0.25 * (f.transparency || 0);
    const hesitant = 0.65 * (f.deflection || 0) + 0.62 * (f.proceduralRestraint || 0) + 0.35 * (f.selfProtection || 0);
    const competence = clamp((decisive - hesitant) * (0.45 + 1.05 * salience)
        + 0.40 * (f.horizon > 0 ? f.horizon : 0) * (1 - salience), -1, 1);
    const reach = clamp(0.30 + scrutiny * 0.55 + salience * 0.2, 0.1, 1);
    const mk = (impl, trait, dg) => Math.abs(impl) < 0.05 ? null : ({
        implication: impl, strength: 0.45 + 0.25 * Math.abs(impl), reliability: 0.95,
        diagnosticity: dg, deniability: 0, trait, targetSide: 'PLAYER_SIDE',
        // Damaging coverage of you is carried by outlets hostile to you. That is the
        // whole substrate for "they've got an agenda" — with a neutral source it never bites.
        sourceAlignment: impl < 0 ? 'OPPOSED' : 'ALIGNED', crowd: null, mediaReach: reach,
    });
    return [mk(integrity, 'integrity', 0.55), mk(competence, 'competence', 0.6)]
        .filter(Boolean)
        .map((o) => (ctx.stakes ? { ...o, stakes: ctx.stakes } : o));
}
// ── Delayed chains ───────────────────────────────────────────────────────────
// A chain resolves years later. What it costs you depends on what you SAID privately
// and what you DID publicly, compared against what turned out to be true.
// CRED[] indexes the 4-point private ladder: 0.15 / 0.40 / 0.60 / 0.85.
// Liability accrued by a single choice. Exploitation and deflection buy short-term
// advantage and are quietly remembered; procedure and disclosure pay it down.
function choiceLiability(features) {
    const f = features || {};
    return Math.max(0, 1.00 * (f.exploitation || 0)
        + 0.70 * (f.deflection || 0)
        + 0.60 * (f.selfProtection || 0)
        + 0.55 * (f.institutionalCost || 0)
        - 0.45 * (f.transparency || 0)
        - 0.35 * (f.proceduralRestraint || 0));
}
// The reckoning. Fires once, late, before the decisive election. Nothing happens below
// the threshold — a couple of hard-nosed calls are just politics. A pattern is a story.
function liabilityReckoning(total, thr = 1.8) {
    if (total < thr)
        return null;
    const over = Math.min(total - thr, 3.2);
    return {
        magnitude: over,
        signal: { implication: -clamp(0.18 + 0.20 * over, 0, 0.85), strength: 0.72, reliability: 0.9,
            diagnosticity: 0.8, deniability: 0.1, trait: 'integrity', targetSide: 'PLAYER_SIDE',
            sourceAlignment: 'OPPOSED', crowd: { direction: -1, magnitude: clamp(0.25 + 0.18 * over, 0, 0.8), independence: 0.3 },
            mediaReach: clamp(0.55 + 0.12 * over, 0, 0.95) },
    };
}
function chainVerdict(outcome, credence, move) {
    const believed = credence === null || credence === undefined ? 0.5 : [0.15, 0.40, 0.60, 0.85][credence];
    const procedural = move?.features?.proceduralRestraint ?? 0;
    const sanctioned = (move?.features?.exploitation ?? 0) + (move?.features?.concession ?? 0);
    const shielded = (move?.features?.selfProtection ?? 0) + (move?.features?.deflection ?? 0);
    let credibility = 0, calledIt = null;
    if (outcome === 'CONFIRMED') {
        credibility = (believed - 0.5) * 1.4 - shielded * 0.55 + procedural * 0.25;
        calledIt = believed >= 0.45;
    }
    else if (outcome === 'DISPROVEN') {
        credibility = (0.5 - believed) * 1.4 - sanctioned * 0.60 + procedural * 0.45;
        calledIt = believed <= 0.55;
    }
    else { // UNRESOLVED — nobody is vindicated; loud early positions age worst
        credibility = procedural * 0.30 - Math.abs(believed - 0.5) * 0.35 - sanctioned * 0.20;
        calledIt = null;
    }
    credibility = clamp(credibility, -1, 1);
    // Tone now follows the thing the player is actually shown moving.
    const tone = outcome === 'UNRESOLVED' ? 'murky'
        : credibility > 0.06 ? 'right' : credibility < -0.06 ? 'wrong' : 'mixed';
    return {
        outcome, tone, beliefTone: tone, calledIt, credibility, believed, procedural,
        signal: Math.abs(credibility) < 0.06 ? null : {
            implication: credibility, strength: 0.7, reliability: 0.95, diagnosticity: 0.65,
            deniability: 0, trait: 'competence', targetSide: 'PLAYER_SIDE',
            sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.75,
        },
    };
}
// Mean belief restricted to a subgroup. The identity mechanisms only act on voters
// who identify with the target's side, so a whole-electorate average hides them.
function meanBeliefWhere(agents, actorId, trait, pred) {
    let s = 0, n = 0;
    for (const a of agents) {
        if (!pred(a))
            continue;
        const b = a.beliefs[actorId];
        if (b) {
            s += (0, exports.sigmoid)(b[trait].mu);
            n++;
        }
    }
    return n ? s / n : 0.5;
}
function meanBelief(agents, actorId, trait = 'integrity') {
    let s = 0, n = 0;
    for (const a of agents) {
        const b = a.beliefs[actorId];
        if (b) {
            s += (0, exports.sigmoid)(b[trait].mu);
            n++;
        }
    }
    return n ? s / n : 0.5;
}
function meanPrecision(agents, actorId, trait = 'integrity') {
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
        if (!b)
            continue;
        const wi = a.wInt ?? 1.5, wc = a.wComp ?? 1.5;
        s += (wi * (0, exports.sigmoid)(b.integrity.mu) + wc * (0, exports.sigmoid)(b.competence.mu)) / (wi + wc);
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
// ─────────────────────────────── Election ───────────────────────────────
// Turnout is separate from utility, so approval and vote share can diverge.
const W = { party: 1.4, ideology: 0.7, retro: 1.75, noise: 0.6 };
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
            const partyMatch = c.bloc === 'IND' ? 0 : (a.side === c.bloc ? 1 : (a.side === 'IND' ? 0.15 : -1));
            let u = W.party * partyMatch * Math.abs(a.lean)
                - W.ideology * Math.abs(a.ideology - (c.ideology ?? 0))
                + W.retro * (c.retro ?? 0) * (0.4 + 0.6 * a.instTrust)
                + W.noise * rng.gumbel();
            if (b)
                u += (a.wInt ?? 1.5) * ((0, exports.sigmoid)(b.integrity.mu) - 0.5) + (a.wComp ?? 1.5) * ((0, exports.sigmoid)(b.competence.mu) - 0.5);
            else
                u -= 0.6; // unknown candidate penalty
            u += (c.homeAdvantage ?? 0) * (a.side === c.bloc ? 1 : 0.3);
            // Being known matters on its own. Four years out of sight is a real electoral cost;
            // four years on a panel show is a real electoral asset, whatever people think of you.
            u += 0.85 * ((c.recognition ?? 0.5) - 0.5) * (0.5 + 0.5 * a.interest);
            return { id: c.id, u };
        });
        us.sort((x, y) => (0, exports.q6)(y.u) - (0, exports.q6)(x.u));
        for (const c of us)
            util[c.id] += c.u;
        const margin = (0, exports.q6)(us[0].u - (us[1] ? us[1].u : us[0].u - 1));
        const mobilise = ctx.mobilisation?.[us[0].id] ?? 0;
        const pVote = clamp(a.turnoutBase + 0.10 * clamp(margin, 0, 2) + mobilise - 0.12 * (1 - a.interest), 0.01, 0.99);
        if ((0, exports.q6)(rng.float()) < (0, exports.q6)(pVote)) {
            turnedOut++;
            tally[us[0].id]++;
        }
    }
    const total = Object.values(tally).reduce((x, y) => x + y, 0) || 1;
    const shares = {};
    for (const c of candidates)
        shares[c.id] = tally[c.id] / total;
    const winner = candidates.reduce((best, c) => (tally[c.id] > tally[best.id] ? c : best), candidates[0]);
    return { tally, shares, winner: winner.id, turnout: turnedOut / agents.length };
}
// ──────────────────────── Player analysis (the Mirror) ────────────────────────
// Deliberately simple: matched comparisons and slopes over the actual decision log.
// No latent-trait model, no psychometric scoring, no comparison to other people.
const CRED = [0.15, 0.40, 0.60, 0.85]; // locked credence anchors for the 4-point ladder
const SAID = ['said there was nothing there', 'called it probably overblown',
    'thought it was probably real', 'treated it as established'];
exports.CRED_LABEL = SAID;
function linSlope(xs, ys) {
    const n = xs.length;
    if (n < 3)
        return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0, sy = 0;
    for (let i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (0, det_math_mjs_1.detSquare)(xs[i] - mx);
        sy += (0, det_math_mjs_1.detSquare)(ys[i] - my);
    }
    if (den < 1e-9)
        return null;
    const slope = num / den;
    const r2 = sy < 1e-9 ? 0 : (num * num) / (den * sy);
    return { slope, r2, n };
}
// Confidence from how much we saw and how consistently, NOT from a posterior.
function confFromPairs(diffs) {
    if (diffs.length === 0)
        return 0;
    if (diffs.length === 1)
        return 0.38;
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((a, b) => a + (0, det_math_mjs_1.detSquare)(b - mean), 0) / diffs.length);
    const agreement = diffs.every((d) => Math.sign(d) === Math.sign(mean)) ? 1 : 0.45;
    const base = clamp(0.30 + 0.16 * diffs.length, 0, 0.86);
    return clamp(base * agreement * (1 - clamp(sd / 0.5, 0, 0.5)), 0, 0.92);
}
function analysePlayer(log) {
    const reads = log.filter((e) => e.kind === 'read');
    const moves = log.filter((e) => e.kind === 'move');
    const dims = {};
    // 1. Evidence Sensitivity — slope of stated credence on evidence quality.
    const xs = reads.map((r) => r.strength * r.reliability);
    const ys = reads.map((r) => CRED[r.credence]);
    const fit = linSlope(xs, ys);
    const sorted = [...reads].sort((a, b) => (b.strength * b.reliability) - (a.strength * a.reliability));
    const evCases = reads.length >= 2 ? [{
            hi: { title: sorted[0].title, said: SAID[sorted[0].credence], q: sorted[0].strength * sorted[0].reliability },
            lo: { title: sorted[sorted.length - 1].title, said: SAID[sorted[sorted.length - 1].credence],
                q: sorted[sorted.length - 1].strength * sorted[sorted.length - 1].reliability },
            diff: CRED[sorted[0].credence] - CRED[sorted[sorted.length - 1].credence]
        }] : [];
    dims.evidenceSensitivity = {
        cases: evCases,
        label: 'Evidence Sensitivity',
        n: reads.length,
        value: fit ? clamp(fit.slope, -1.2, 1.6) : null,
        conf: fit ? clamp(0.22 + 0.05 * fit.n + 0.30 * fit.r2, 0, 0.9) : 0,
        detail: fit ? `slope ${fit.slope.toFixed(2)} across ${fit.n} judgments` : 'not enough judgments',
    };
    // 2/3/4. Matched-pair dimensions. Each pair differs on exactly one factor.
    const pairDim = (factor, key, label, hi) => {
        const groups = {};
        for (const r of reads) {
            if (!r.pairId || r.factor !== factor)
                continue;
            (groups[r.pairId] ||= []).push(r);
        }
        const diffs = [];
        const cases = [];
        for (const pid of Object.keys(groups)) {
            const g = groups[pid];
            if (g.length !== 2)
                continue;
            const a = g.find((x) => x.level === hi), b = g.find((x) => x.level !== hi);
            if (!a || !b)
                continue;
            diffs.push(CRED[a.credence] - CRED[b.credence]);
            cases.push({ diff: CRED[a.credence] - CRED[b.credence],
                hi: { title: a.title, said: SAID[a.credence], q: a.strength * a.reliability },
                lo: { title: b.title, said: SAID[b.credence], q: b.strength * b.reliability } });
        }
        const mean = diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : null;
        dims[key] = { label, n: diffs.length, value: mean, conf: confFromPairs(diffs), cases };
    };
    pairDim('PARTISAN', 'partisanSymmetry', 'Partisan Symmetry', 'OPPOSING_SIDE');
    pairDim('CROWD', 'crowdSusceptibility', 'Crowd Susceptibility', 'CROWD_HIGH');
    pairDim('DENIABILITY', 'deniabilitySusceptibility', 'Deniability Susceptibility', 'DEN_HIGH');
    // Political Self — averaged coded features of the actions actually taken.
    const feat = (name, filter = () => true) => {
        const v = moves.filter(filter).map((m) => m.features[name] ?? 0);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const respMoves = moves.filter((m) => m.responsibility);
    const pol = {};
    pol.accountability = {
        label: 'Accountability', n: respMoves.length,
        value: respMoves.length ? feat('concession', (m) => m.responsibility) - feat('deflection', (m) => m.responsibility) : null,
    };
    pol.institutionalRestraint = {
        label: 'Institutional Restraint', n: moves.filter((m) => m.institutional).length,
        value: moves.some((m) => m.institutional)
            ? feat('proceduralRestraint', (m) => m.institutional) - feat('institutionalCost', (m) => m.institutional) : null,
    };
    pol.powerOrientation = {
        label: 'Power / Survival Orientation', n: moves.length,
        value: moves.length ? feat('electoralGain') - feat('horizon') : null,
    };
    const cite = (filter, feat) => moves.filter(filter)
        .sort((a, b) => (b.features[feat] ?? 0) - (a.features[feat] ?? 0))
        .slice(0, 2).map((m) => ({ title: m.title, label: m.label }));
    pol.accountability.cases = cite((m) => m.responsibility, 'concession');
    pol.institutionalRestraint.cases = cite((m) => m.institutional, 'proceduralRestraint');
    pol.powerOrientation.cases = cite(() => true, 'electoralGain');
    for (const k of Object.keys(pol))
        pol[k].conf = clamp(0.18 + 0.11 * pol[k].n, 0, 0.85);
    return { voter: dims, political: pol, nReads: reads.length, nMoves: moves.length };
}
// Mirror Resolution — evidence volume, coverage, replication, consistency.
// Never hard-coded per life, and it can fail to improve if a life was redundant.
function mirrorResolution(analysis, log) {
    const reads = log.filter((e) => e.kind === 'read');
    const volume = clamp(reads.length / 14, 0, 1);
    const cats = new Set();
    for (const r of reads) {
        if (r.strength * r.reliability > 0.5)
            cats.add('strongEvidence');
        else
            cats.add('weakEvidence');
        if (r.targetSide === 'OPPOSING_SIDE')
            cats.add('opposing');
        if (r.targetSide === 'PLAYER_SIDE')
            cats.add('aligned');
        if (r.factor === 'CROWD' && r.level === 'CROWD_HIGH')
            cats.add('crowd');
        if (r.factor === 'DENIABILITY' && r.level === 'DEN_HIGH')
            cats.add('deniable');
    }
    for (const m of log.filter((e) => e.kind === 'move')) {
        if (m.institutional)
            cats.add('institutional');
        if (m.temptation)
            cats.add('temptation');
        if (m.responsibility)
            cats.add('personalExposure');
    }
    const COVER = ['strongEvidence', 'weakEvidence', 'opposing', 'aligned', 'crowd', 'deniable', 'institutional', 'temptation', 'personalExposure'];
    const coverage = COVER.filter((c) => cats.has(c)).length / COVER.length;
    const dimsWithPairs = ['partisanSymmetry', 'crowdSusceptibility', 'deniabilitySusceptibility'];
    const replication = dimsWithPairs.reduce((acc, k) => acc + clamp((analysis.voter[k]?.n ?? 0) / 2, 0, 1), 0) / dimsWithPairs.length;
    const confs = [...Object.values(analysis.voter), ...Object.values(analysis.political)].map((d) => d.conf ?? 0);
    const consistency = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
    const res = 0.30 * volume + 0.30 * coverage + 0.20 * replication + 0.20 * consistency;
    return {
        resolution: clamp(res, 0, 0.98),
        components: { volume, coverage, replication, consistency },
        missing: COVER.filter((c) => !cats.has(c)),
    };
}
// Cross-Mirror: how you acted vs how you judged. The point of the whole product.
function crossMirror(analysis, log) {
    const out = [];
    const ps = analysis.voter.partisanSymmetry;
    const moves = log.filter((e) => e.kind === 'move');
    const ownExposure = moves.filter((m) => m.responsibility);
    const proceduralWhenExposed = ownExposure.length
        ? ownExposure.reduce((a, m) => a + (m.features.proceduralRestraint ?? 0), 0) / ownExposure.length : null;
    if (ps && ps.n > 0 && proceduralWhenExposed !== null) {
        const asked = ps.value; // + means harsher on opposing side at matched evidence
        if (proceduralWhenExposed >= 0.25 && asked > 0.08) {
            out.push({
                title: 'You valued due process most when you needed it yourself.',
                politician: `When you were the one exposed, you chose the procedural option ${(proceduralWhenExposed * 100).toFixed(0)}% of the way.`,
                voter: `In matched controversies with the same evidence, you were ${(asked * 100).toFixed(0)} points readier to believe the charge when the target was on the other side.`,
                options: ['I trusted the process more when I could see it up close', 'I judged the other side more harshly', 'The two situations were not really the same'],
            });
        }
    }
    const crowd = analysis.voter.crowdSusceptibility;
    const usedOutrage = moves.length ? moves.reduce((a, m) => a + (m.features.exploitation ?? 0), 0) / moves.length : 0;
    if (crowd && crowd.n > 0 && crowd.value !== null && crowd.value > 0.08 && usedOutrage < 0.5) {
        out.push({
            title: 'You resisted using outrage — but you were not immune to it.',
            politician: `You rarely reached for the outrage play (${(usedOutrage * 100).toFixed(0)}% across your responses).`,
            voter: `With the same underlying evidence, visible public anger moved your judgment by ${(crowd.value * 100).toFixed(0)} points.`,
            options: ['Public anger is information', 'I was influenced more than I thought', 'One comparison is not enough to say'],
        });
    }
    if (ps && ps.n > 0 && ps.value !== null && ps.value > 0.25 && (proceduralWhenExposed === null || proceduralWhenExposed < 0.25)) {
        const sanction = moves.filter((m) => !m.responsibility)
            .reduce((a, m) => a + (m.features.exploitation ?? 0), 0) / Math.max(1, moves.filter((m) => !m.responsibility).length);
        out.push({
            title: 'Your evidence bar moved with the target.',
            politician: `When the story was about someone else you reached for the hard option ${(sanction * 100).toFixed(0)}% of the way.`,
            voter: `Privately, with identical evidence in both cases, you were ${(ps.value * 100).toFixed(0)} points readier to believe it when the person was on the other side.`,
            options: ['I had reasons to trust my own side', 'I applied a lower bar to opponents', 'The cases were not really identical'],
        });
    }
    const ev = analysis.voter.evidenceSensitivity;
    const exploited = moves.length ? moves.reduce((a, m) => a + (m.features.exploitation ?? 0), 0) / moves.length : 0;
    if (ev && ev.n >= 4 && ev.value !== null && ev.value > 0.35 && exploited > 0.4) {
        out.push({
            title: 'You wanted evidence. You did not always wait for it.',
            politician: `Across your public responses you reached for the aggressive option ${(exploited * 100).toFixed(0)}% of the way.`,
            voter: `Yet your private judgments tracked evidence quality closely — you moved ${ev.value.toFixed(2)} points of credence per unit of evidence.`,
            options: ['Knowing better and acting anyway is just politics', 'I was harsher in public than in private', 'Winning required it'],
        });
    }
    return out;
}
// Personalized real-world checklist, generated only from dimensions with evidence.
function checklist(analysis) {
    const out = [];
    const v = analysis.voter;
    if (v.crowdSusceptibility?.n > 0 && (v.crowdSusceptibility.value ?? 0) > 0.1)
        out.push('When a controversy goes viral, read the underlying evidence before you read the comments or the reaction counts.');
    if (v.partisanSymmetry?.n > 0 && Math.abs(v.partisanSymmetry.value ?? 0) > 0.12)
        out.push('Ask what evidence you would need if the politician belonged to the other side.');
    if (v.deniabilitySusceptibility?.n > 0 && (v.deniabilitySusceptibility.value ?? 0) < -0.1)
        out.push('"AI-generated" is itself a claim, and it needs evidence of its own.');
    if (v.evidenceSensitivity?.value !== null && (v.evidenceSensitivity?.value ?? 0) < 0.25)
        out.push('Your judgments moved little between weak and strong evidence. Try naming, out loud, what would change your mind.');
    if (out.length === 0)
        out.push('Nothing in this run cleared the evidence bar for personalized advice. That is a real result, not a placeholder.');
    return out;
}
// ── Counterfactual electorate replay ─────────────────────────────────────────
// Records every event and election as a "tape", then replays the identical career
// against a freshly built electorate with one cognitive mechanism switched off.
// Common random numbers throughout: the ONLY thing that differs is the mechanism.
function makeTape() { return { entries: [] }; }
function tapeEvent(tape, ev) { tape.entries.push({ t: 'event', ev }); }
function tapeElection(tape, spec) { tape.entries.push({ t: 'election', spec }); }
function tapeAge(tape, age, years, label = 'extra time', mode = 'extra') {
    tape.entries.push({ t: 'age', age, years, label, mode });
}
exports.CF_CONDITIONS = [
    { id: 'ACTUAL', label: 'What actually happened', suppress: {}, group: 'all', who: 'everyone' },
    { id: 'NO_GATE', label: 'If nobody refused to look at the evidence', suppress: { gate: true },
        group: 'B', who: 'the voters who reject inconvenient evidence outright' },
    { id: 'NO_MOTIV', label: 'If nobody discounted what the evidence meant', suppress: { motiv: true },
        group: 'C', who: 'the voters who accept a story but not what it implies' },
    { id: 'NO_SOURCE', label: 'If nobody dismissed the messenger', suppress: { source: true },
        group: 'D', who: 'the voters who distrust hostile outlets' },
    { id: 'NO_CROWD', label: 'If public anger moved nobody', suppress: { crowd: true },
        group: 'crowd', who: 'the voters most responsive to public mood' },
];
// Single source of truth for world construction. play() and replayCareer() MUST
// consume the world RNG in exactly the same order or the audit silently compares
// the player's career against a different world.
function buildInitialWorld(world) {
    const wr = makeRng(world.worldSeed);
    const tilt = wr.range(-0.85, 0.85);
    const agents = makeElectorate(wr, world.n, world.playerBloc, world.rivalBloc, tilt);
    seedBeliefs(agents, 'PLAYER', world.startMu, world.startTau, wr);
    const rq = wr.range(-0.25, 0.75);
    seedBeliefs(agents, 'RIVAL1', 0.35 + rq * 0.7, 1.25, wr);
    seedBeliefs(agents, 'RIVAL2', rq * 0.3, 0.45, wr);
    return { agents, wr, tilt, rq };
}
function replayCareer(tape, world, suppress) {
    const { agents } = buildInitialWorld(world);
    // Third-party actors are seeded from their OWN stream, in tape order, so that
    // adding a draw anywhere else cannot shift them.
    const actorRng = makeRng(world.actorSeed);
    const evRng = makeRng(world.eventSeed);
    const elections = [];
    const moments = []; // per-event belief deltas on the player's own bad news
    let lastAge = world.startAge ?? 23;
    for (const e of tape.entries) {
        if (e.t === 'event') {
            if (e.ev.__age && e.ev.__age > lastAge) {
                ageElectorate(agents, e.ev.__age - lastAge);
                lastAge = e.ev.__age;
            }
            if (e.ev.__seedActor)
                seedBeliefs(agents, e.ev.actorId, e.ev.__seedActor[0], e.ev.__seedActor[1], actorRng);
            const watch = e.ev.actorId === 'PLAYER' && e.ev.implication < -0.25;
            // Record the movement inside each cognitive family separately. A mechanism that
            // only 22% of one side possesses is invisible in a topline average and obvious
            // inside the group that has it — the group is the honest place to report it.
            const tr = e.ev.trait || 'integrity';
            // Report inside the group the mechanism can actually act on. The identity
            // mechanisms only fire for voters aligned with the target who have something at
            // stake; averaging over all of family B dilutes the effect by roughly 3x and
            // makes a real mechanism look like nothing.
            const engaged = (a) => a.side === world.playerBloc && Math.abs(a.lean) * a.interest > 0.22;
            const GRP = { all: () => true,
                B: (a) => a.family === 'B' && engaged(a),
                C: (a) => a.family === 'C' && engaged(a),
                D: (a) => a.family === 'D' && engaged(a),
                crowd: (a) => a.crowdSens > 0.6 };
            const b0 = watch ? Object.fromEntries(Object.entries(GRP)
                .map(([k, f]) => [k, meanBeliefWhere(agents, 'PLAYER', tr, f)])) : null;
            applyEvent(agents, e.ev, evRng, world.playerBloc, { suppress });
            if (watch)
                moments.push({ age: e.ev.__age, trait: tr, label: e.ev.__label || 'a story about you',
                    deltas: Object.fromEntries(Object.entries(GRP)
                        .map(([k, f]) => [k, meanBeliefWhere(agents, 'PLAYER', tr, f) - b0[k]])) });
        }
        else if (e.t === 'age') {
            if (e.mode === 'timeline') {
                ageElectorate(agents, e.years);
                lastAge = e.age;
            }
            else {
                if (e.age > lastAge) {
                    ageElectorate(agents, e.age - lastAge);
                    lastAge = e.age;
                }
                ageElectorate(agents, e.years);
            }
        }
        else {
            const s = e.spec;
            if (s.age > lastAge) {
                ageElectorate(agents, s.age - lastAge);
                lastAge = s.age;
            }
            const res = runElection(agents, s.candidates, makeRng(s.seed), s.ctx);
            elections.push({ id: s.electionId, office: s.office, age: s.age,
                won: res.winner === 'PLAYER', share: res.shares.PLAYER, turnout: res.turnout });
        }
    }
    return { agents, elections, moments, approval: approvalOf(agents, 'PLAYER'), belief: meanBelief(agents, 'PLAYER') };
}
// Only report a counterfactual difference if it is big enough to mean something.
// A flipped election always counts; a share move under the band never does.
exports.CF_BAND = 0.018; // vote share / approval
exports.CF_MOMENT_BAND = 0.015; // per-event belief movement within the affected group
function counterfactualAudit(tape, world) {
    const actual = replayCareer(tape, world, {});
    const out = [];
    for (const c of exports.CF_CONDITIONS.slice(1)) {
        const r = replayCareer(tape, world, c.suppress);
        const diffs = [];
        r.elections.forEach((el, i) => {
            const a = actual.elections[i];
            if (!a)
                return;
            const d = el.share - a.share;
            if (el.won !== a.won)
                diffs.push({ el, a, d, flipped: true });
            else if (Math.abs(d) >= exports.CF_BAND)
                diffs.push({ el, a, d, flipped: false });
        });
        const approvalDiff = r.approval - actual.approval;
        // Where the mechanisms are actually visible: the moment a story broke, not the
        // election four years later. Aggregate effects wash out; moments do not.
        const g = c.group || 'all';
        const momentDiffs = r.moments.map((mm, i) => {
            const am = actual.moments[i];
            if (!am)
                return null;
            return { age: mm.age, label: mm.label, who: c.who,
                actual: am.deltas[g], alt: mm.deltas[g], gap: mm.deltas[g] - am.deltas[g] };
        }).filter((x) => x && Math.abs(x.gap) >= exports.CF_MOMENT_BAND)
            .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));
        // How much of what happened to this player's reputation was the mechanism rather
        // than the player? Reported as a share of total movement, because the outcome-level
        // difference over one career is genuinely small and pretending otherwise would lie.
        let gapSum = 0, moveSum = 0;
        r.moments.forEach((mm, i) => {
            const am = actual.moments[i];
            if (!am)
                return;
            gapSum += Math.abs(mm.deltas[g] - am.deltas[g]);
            moveSum += Math.abs(am.deltas[g]);
        });
        const share = moveSum > 1e-9 ? gapSum / moveSum : 0;
        const biggest = momentDiffs[0] || null;
        const interpretable = diffs.length > 0 || share >= 0.05 || Math.abs(approvalDiff) >= exports.CF_BAND;
        out.push({ ...c, elections: r.elections, diffs, momentDiffs, biggest, share, approvalDiff, interpretable });
    }
    return { actual, conditions: out };
}
// ───────────────────── Resource gating (P4) ─────────────────────
// A politician often cannot choose the ideal response because the resources to execute it
// do not exist. Returns why an option is unavailable so the interface can say so plainly
// rather than hiding the option and pretending it was never possible.
function choiceAvailability(choice, st) {
    const cost = choice.cost;
    if (!cost)
        return { ok: true };
    for (const [k, v] of Object.entries(cost)) {
        if ((st[k] ?? 0) < v) {
            return { ok: false, reason: choice.lockNote || 'You do not have the resources for this.',
                need: { key: k, have: st[k] ?? 0, want: v } };
        }
    }
    return { ok: true };
}
function payCost(choice, st) {
    for (const [k, v] of Object.entries(choice.cost || {}))
        st[k] = Math.max(0, (st[k] ?? 0) - v);
}

}],
"src/det-math.mjs": [{}, function(module, exports, require) {
"use strict";
// Political Mirror — deterministic transcendental functions for the canonical engine.
//
// ECMAScript guarantees correctly rounded IEEE-754 results for + - * / and Math.sqrt, but
// NOT for Math.exp, Math.expm1, Math.log, Math.tanh, Math.pow or the ** operator. Those are
// "implementation-approximated": their last bit depends on the engine's native libm port,
// its version and how it was compiled (FMA contraction, vectorisation). The canonical
// session hashes full-precision state after every action, so one ulp anywhere in the
// canonical path is a browser/headless parity failure. v0.37.2's first divergence was
// exactly that: action 27 of the POL-M7GX4 path, state.reactions[31].delta, Chrome 153
// (-0.010428308748461457) vs Node 24 (-0.010428308748461346) — a single sigmoid() value
// inside meanBelief() rounded differently by the two engines' Math.exp.
//
// The functions below are straight ports of the Sun/FreeBSD fdlibm algorithms
// (e_exp.c, s_expm1.c, e_log.c, s_tanh.c) written with basic double arithmetic and
// explicit bit access only. Every conforming JavaScript engine therefore produces
// identical bits for identical inputs. They are not correctly rounded (fdlibm is < 1 ulp);
// they are reproducible, which is the property the canonical hash needs. No tolerance,
// no rounding-for-hash, no engine detection.
Object.defineProperty(exports, "__esModule", { value: true });
exports.detBits = exports.detSquare = void 0;
exports.detExp = detExp;
exports.detExpm1 = detExpm1;
exports.detTanh = detTanh;
exports.detLog = detLog;
const bits = new DataView(new ArrayBuffer(8));
// DataView defaults to big-endian, so byte offset 0 is always the high word regardless of
// the host CPU's endianness.
function highWord(x) { bits.setFloat64(0, x); return bits.getUint32(0); }
function lowWord(x) { bits.setFloat64(0, x); return bits.getUint32(4); }
function fromWords(hi, lo) { bits.setUint32(0, hi >>> 0); bits.setUint32(4, lo >>> 0); return bits.getFloat64(0); }
function withHighWord(x, hi) { bits.setFloat64(0, x); bits.setUint32(0, hi >>> 0); return bits.getFloat64(0); }
// Shared constants (decimal literals are the fdlibm ones; each round-trips to the exact
// double whose hex words are given in tests/det-math.test.mjs).
const HUGE = 1.0e300;
const TINY = 1.0e-300;
const LN2_HI = 6.93147180369123816490e-01; // 3fe62e42 fee00000
const LN2_LO = 1.90821492927058770002e-10; // 3dea39ef 35793c76
const INV_LN2 = 1.44269504088896338700e+00; // 3ff71547 652b82fe
const O_THRESHOLD = 7.09782712893383973096e+02; // 40862e42 fefa39ef
const U_THRESHOLD = -7.45133219101941108420e+02; // c0874910 d52d3051
const TWO_M1000 = 9.33263618503218878990e-302; // 01700000 00000000
const TWO_P1023 = 8.98846567431157953865e+307; // 7fe00000 00000000
const TWO54 = 1.80143985094819840000e+16; // 43500000 00000000
// ── exp: fdlibm e_exp.c ──────────────────────────────────────────────────────────────
const EXP_P1 = 1.66666666666666019037e-01; // 3fc55555 5555553e
const EXP_P2 = -2.77777777770155933842e-03; // bf66c16c 16bebd93
const EXP_P3 = 6.61375632143793436117e-05; // 3f11566a af25de2c
const EXP_P4 = -1.65339022054652515390e-06; // bebbbd41 c5d26bf1
const EXP_P5 = 4.13813679705723846039e-08; // 3e663769 72bea4d0
function detExp(x) {
    let hx = highWord(x);
    const xsb = (hx >>> 31) & 1; // sign bit
    hx &= 0x7fffffff; // high word of |x|
    if (hx >= 0x40862E42) { // |x| >= 709.78…
        if (hx >= 0x7ff00000) {
            if (((hx & 0xfffff) | lowWord(x)) !== 0)
                return x + x; // NaN
            return xsb === 0 ? x : 0; // exp(±Infinity)
        }
        if (x > O_THRESHOLD)
            return HUGE * HUGE; // overflow → Infinity
        if (x < U_THRESHOLD)
            return TWO_M1000 * TWO_M1000; // underflow → 0
    }
    let k = 0, hi = 0, lo = 0;
    if (hx > 0x3fd62e42) { // |x| > 0.5 ln2: argument reduction
        if (hx < 0x3FF0A2B2) { // |x| < 1.5 ln2
            hi = x - (xsb === 0 ? LN2_HI : -LN2_HI);
            lo = xsb === 0 ? LN2_LO : -LN2_LO;
            k = 1 - xsb - xsb;
        }
        else {
            k = Math.trunc(INV_LN2 * x + (xsb === 0 ? 0.5 : -0.5));
            const t = k;
            hi = x - t * LN2_HI; // exact
            lo = t * LN2_LO;
        }
        x = hi - lo;
    }
    else if (hx < 0x3e300000) { // |x| < 2^-28
        return 1 + x;
    }
    const t = x * x;
    const c = x - t * (EXP_P1 + t * (EXP_P2 + t * (EXP_P3 + t * (EXP_P4 + t * EXP_P5))));
    if (k === 0)
        return 1 - ((x * c) / (c - 2.0) - x);
    const y = 1 - ((lo - (x * c) / (2.0 - c)) - hi);
    if (k >= -1021) {
        if (k === 1024)
            return y * 2.0 * TWO_P1023;
        return y * fromWords((0x3ff + k) << 20, 0); // × 2^k, exact
    }
    return y * fromWords((0x3ff + (k + 1000)) << 20, 0) * TWO_M1000;
}
// ── expm1: fdlibm s_expm1.c (used by tanh) ───────────────────────────────────────────
const EM1_Q1 = -3.33333333333331316428e-02; // bfa11111 111110f4
const EM1_Q2 = 1.58730158725481460165e-03; // 3f5a01a0 19fe5585
const EM1_Q3 = -7.93650757867487942473e-05; // bf14ce19 9eaadbb7
const EM1_Q4 = 4.00821782732936239552e-06; // 3ed0cfca 86e65239
const EM1_Q5 = -2.01099218183624371326e-07; // be8afdb7 6e09c32d
function detExpm1(x) {
    let hx = highWord(x);
    const negative = (hx & 0x80000000) !== 0;
    hx &= 0x7fffffff;
    if (hx >= 0x4043687A) { // |x| >= 56 ln2
        if (hx >= 0x40862E42) { // |x| >= 709.78…
            if (hx >= 0x7ff00000) {
                if (((hx & 0xfffff) | lowWord(x)) !== 0)
                    return x + x; // NaN
                return negative ? -1.0 : x; // expm1(±Infinity)
            }
            if (x > O_THRESHOLD)
                return HUGE * HUGE; // overflow
        }
        if (negative)
            return TINY - 1.0; // x < -56 ln2 → -1
    }
    let k = 0, hi, lo, c = 0;
    if (hx > 0x3fd62e42) { // |x| > 0.5 ln2
        if (hx < 0x3FF0A2B2) { // |x| < 1.5 ln2
            if (!negative) {
                hi = x - LN2_HI;
                lo = LN2_LO;
                k = 1;
            }
            else {
                hi = x + LN2_HI;
                lo = -LN2_LO;
                k = -1;
            }
        }
        else {
            k = Math.trunc(INV_LN2 * x + (negative ? -0.5 : 0.5));
            const t = k;
            hi = x - t * LN2_HI;
            lo = t * LN2_LO;
        }
        x = hi - lo;
        c = (hi - x) - lo;
    }
    else if (hx < 0x3c900000) { // |x| < 2^-54
        return x;
    }
    const hfx = 0.5 * x;
    const hxs = x * hfx;
    const r1 = 1 + hxs * (EM1_Q1 + hxs * (EM1_Q2 + hxs * (EM1_Q3 + hxs * (EM1_Q4 + hxs * EM1_Q5))));
    let t = 3.0 - r1 * hfx;
    let e = hxs * ((r1 - t) / (6.0 - x * t));
    if (k === 0)
        return x - (x * e - hxs);
    const twopk = fromWords(0x3ff00000 + (k << 20), 0); // 2^k
    e = (x * (e - c) - c);
    e -= hxs;
    if (k === -1)
        return 0.5 * (x - e) - 0.5;
    if (k === 1) {
        if (x < -0.25)
            return -2.0 * (e - (x + 0.5));
        return 1 + 2.0 * (x - e);
    }
    if (k <= -2 || k > 56) {
        let y = 1 - (e - x);
        y = k === 1024 ? y * 2.0 * TWO_P1023 : y * twopk;
        return y - 1;
    }
    let y;
    if (k < 20) {
        t = fromWords(0x3ff00000 - (0x200000 >> k), 0); // 1 - 2^-k
        y = t - (e - x);
        y = y * twopk;
    }
    else {
        t = fromWords((0x3ff - k) << 20, 0); // 2^-k
        y = x - (e + t);
        y += 1;
        y = y * twopk;
    }
    return y;
}
// ── tanh: fdlibm s_tanh.c ────────────────────────────────────────────────────────────
function detTanh(x) {
    const jx = highWord(x) | 0; // signed high word
    const ix = jx & 0x7fffffff;
    if (ix >= 0x7ff00000)
        return jx >= 0 ? 1 / x + 1 : 1 / x - 1; // ±1 for ±Infinity, NaN stays NaN
    let z;
    if (ix < 0x40360000) { // |x| < 22
        if (ix < 0x3e300000)
            return x; // |x| < 2^-28
        if (ix >= 0x3ff00000) { // |x| >= 1
            const t = detExpm1(2 * Math.abs(x));
            z = 1 - 2 / (t + 2);
        }
        else {
            const t = detExpm1(-2 * Math.abs(x));
            z = -t / (t + 2);
        }
    }
    else {
        z = 1 - TINY; // |x| >= 22 → ±1
    }
    return jx >= 0 ? z : -z;
}
// ── log: fdlibm e_log.c ──────────────────────────────────────────────────────────────
const LG1 = 6.666666666666735130e-01; // 3fe55555 55555593
const LG2 = 3.999999999940941908e-01; // 3fd99999 9997fa04
const LG3 = 2.857142874366239149e-01; // 3fd24924 94229359
const LG4 = 2.222219843214978396e-01; // 3fcc71c5 1d8e78af
const LG5 = 1.818357216161805012e-01; // 3fc74664 96cb03de
const LG6 = 1.531383769920937332e-01; // 3fc39a09 d078c69f
const LG7 = 1.479819860511658591e-01; // 3fc2f112 df3e5244
function detLog(x) {
    let hx = highWord(x) | 0; // signed
    const lx = lowWord(x);
    let k = 0;
    if (hx < 0x00100000) { // x < 2^-1022, zero or negative
        if (((hx & 0x7fffffff) | lx) === 0)
            return -Infinity; // log(±0)
        if (hx < 0)
            return NaN; // log(negative)
        k -= 54;
        x *= TWO54; // subnormal: scale up
        hx = highWord(x) | 0;
    }
    if (hx >= 0x7ff00000)
        return x + x; // Infinity or NaN
    k += (hx >> 20) - 1023;
    hx &= 0x000fffff;
    const i = (hx + 0x95f64) & 0x100000;
    x = withHighWord(x, hx | (i ^ 0x3ff00000)); // normalise to [√½, √2)
    k += (i >> 20);
    const f = x - 1.0;
    if ((0x000fffff & (2 + hx)) < 3) { // -2^-20 <= f < 2^-20
        if (f === 0) {
            if (k === 0)
                return 0;
            return k * LN2_HI + k * LN2_LO;
        }
        const R = f * f * (0.5 - 0.33333333333333333 * f);
        if (k === 0)
            return f - R;
        return k * LN2_HI - ((R - k * LN2_LO) - f);
    }
    const s = f / (2.0 + f);
    const z = s * s;
    const w = z * z;
    const t1 = w * (LG2 + w * (LG4 + w * LG6));
    const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    const R = t2 + t1;
    const i2 = (hx - 0x6147a) | (0x6b851 - hx);
    if (i2 > 0) {
        const hfsq = 0.5 * f * f;
        if (k === 0)
            return f - (hfsq - s * (hfsq + R));
        return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
    }
    if (k === 0)
        return f - s * (f - R);
    return k * LN2_HI - ((s * (f - R) - k * LN2_LO) - f);
}
// x*x in place of x ** 2: the ** operator is Math.pow, which is engine-defined; one IEEE
// multiplication is exact-rounded everywhere.
const detSquare = (v) => v * v;
exports.detSquare = detSquare;
// Bit-level helpers exported for the tests (constant verification, ulp distances).
exports.detBits = { highWord, lowWord, fromWords };

}],
"src/abilities.mjs": [{}, function(module, exports, require) {
"use strict";
// Political Mirror — political ability system (v0.35 prototype).
//
// Layer discipline. These four things are kept separate on purpose:
//   ABILITIES  (here)      what the politician is personally capable of executing
//   RESOURCES  (game st)   funds / capital / standing / recognition / independence
//   REPUTATION (electorate) what 700 simulated voters currently believe
//   MIRROR     (player log) patterns inferred from the human's own judgments
//
// NON-NEGOTIABLE: nothing in this file may touch the Mirror. Abilities change what a
// politician can execute and which options exist. They never touch the credence the
// human states, the coded feature vector of a choice, or anything analysePlayer reads.
// There is a test asserting a min-ability and a max-ability run produce identical
// Mirror output from the same choices.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOMENTUM_THRESHOLD = exports.BACKGROUND_ABILITIES = exports.ABILITY_IDS = exports.ABILITIES = exports.ABILITY_MAX = exports.ABILITY_MIN = void 0;
exports.tierOf = tierOf;
exports.rollAptitude = rollAptitude;
exports.makeAbilities = makeAbilities;
exports.costToRaise = costToRaise;
exports.hasMomentum = hasMomentum;
exports.growthHint = growthHint;
exports.raise = raise;
exports.addExperience = addExperience;
exports.grantPoints = grantPoints;
exports.check = check;
exports.forecastText = forecastText;
exports.mobilisationMultiplier = mobilisationMultiplier;
exports.recognitionGain = recognitionGain;
exports.negotiationDiscount = negotiationDiscount;
exports.meets = meets;
exports.unmetReason = unmetReason;
exports.splitBudget = splitBudget;
exports.focusOutcomeText = focusOutcomeText;
exports.applyFocus = applyFocus;
// ── Scale ───────────────────────────────────────────────────────────────────
// 20–80, kept from the scouting convention. 50 is competent, 80 is exceptional and
// nobody reaches it in more than one thing. A 0–100 scale invites reading "58" as a
// percentage of something; 20–80 reads as a rating, which is what it is.
exports.ABILITY_MIN = 20;
exports.ABILITY_MAX = 80;
exports.ABILITIES = [
    { id: 'COMM', name: 'Public Communication', short: 'Communication',
        does: 'Speeches, debates, press conferences, live town halls. How well a public statement lands, and how fast people come to know who you are.' },
    { id: 'POLICY', name: 'Policy & Governance', short: 'Policy',
        does: 'Drafting, delivery and administration. Whether what you promised actually works, and whether technical options are open to you at all.' },
    { id: 'ORG', name: 'Organization', short: 'Organization',
        does: 'Field operation, volunteers, canvassing, turnout. Converts money and party standing into people who actually vote.' },
    { id: 'NEG', name: 'Negotiation', short: 'Negotiation',
        does: 'Party bargaining, coalitions, legislative deals. What it costs you to get other people to move.' },
    { id: 'STRAT', name: 'Political Strategy', short: 'Strategy',
        does: 'Reading the position. Better internal information, sharper forecasts, steadier judgment when everything is on fire.' },
];
exports.ABILITY_IDS = exports.ABILITIES.map((a) => a.id);
function tierOf(v) {
    if (v >= 75)
        return 'exceptional';
    if (v >= 65)
        return 'elite';
    if (v >= 57)
        return 'strong';
    if (v >= 47)
        return 'competent';
    if (v >= 37)
        return 'developing';
    if (v >= 28)
        return 'weak';
    return 'very weak';
}
// renamed to avoid colliding with engine.mjs when both are inlined into the artifact
const abClamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
// ── Backgrounds ─────────────────────────────────────────────────────────────
// Each background sets a starting profile AND weights which ability is likely to draw
// the hidden signature aptitude. Weights, not guarantees: two organisers are not the
// same person, which is what makes a re-roll worth doing.
exports.BACKGROUND_ABILITIES = {
    STAFF: {
        label: 'Legislative staffer',
        base: { COMM: 36, POLICY: 52, ORG: 40, NEG: 54, STRAT: 50 },
        talent: { COMM: 0.6, POLICY: 1.3, ORG: 0.7, NEG: 1.5, STRAT: 1.4 },
        note: 'You know how a bill actually moves and who has to be asked. You have never had to hold a room.',
    },
    CIVIC: {
        label: 'Community organiser',
        base: { COMM: 53, POLICY: 36, ORG: 56, NEG: 42, STRAT: 43 },
        talent: { COMM: 1.5, POLICY: 0.6, ORG: 1.6, NEG: 0.8, STRAT: 0.9 },
        note: 'You can fill a hall and knock a ward. Nobody in the building owes you a favour and you have never drafted anything.',
    },
    PROF: {
        label: 'Municipal auditor',
        base: { COMM: 38, POLICY: 57, ORG: 39, NEG: 45, STRAT: 51 },
        talent: { COMM: 0.6, POLICY: 1.6, ORG: 0.6, NEG: 0.9, STRAT: 1.3 },
        note: 'You can read a procurement file faster than anyone in the chamber. You are not who they send to the doorstep.',
    },
};
// ── Natural aptitude ────────────────────────────────────────────────────────
// Natural aptitude: the range each ability develops within comfortably. It is NOT a
// wall. A politician can work past their natural range, it simply costs far more time
// than it is usually worth — which is how a player comes to feel where their limits are
// without ever being shown a number.
//
// With only five abilities the ranges must be concentrated, the way YaKyoLife tightens a
// pitcher's four ceilings rather than using the nine-ability spread. Every life gets one
// signature aptitude, one strong, two ordinary and one narrow. The narrow one is the
// point: it forces a real trade-off and makes the next life mechanically different.
const APTITUDE_BANDS = [
    { key: 'signature', lo: 70, hi: 80 },
    { key: 'strong', lo: 58, hi: 68 },
    { key: 'ordinary', lo: 48, hi: 60 },
    { key: 'ordinary2', lo: 48, hi: 60 },
    { key: 'narrow', lo: 38, hi: 50 },
];
// Weighted draw without replacement, so background bias shapes but never dictates.
function weightedOrder(rng, weights) {
    const pool = exports.ABILITY_IDS.map((id) => ({ id, w: Math.max(0.05, weights[id] ?? 1) }));
    const out = [];
    while (pool.length) {
        let total = 0;
        for (const p of pool)
            total += p.w;
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
    const bg = exports.BACKGROUND_ABILITIES[backgroundId] || exports.BACKGROUND_ABILITIES.STAFF;
    const order = weightedOrder(rng, bg.talent);
    // The hard limit is placed on whichever of the lower-drawn abilities the character is
    // already weakest at. Otherwise a limit could land on something the background starts
    // strong in, the sanity clamp would lift it, and the guaranteed weakness would vanish.
    const tail = order.slice(2);
    const narrowId = tail.reduce((lo, id) => (bg.base[id] < bg.base[lo] ? id : lo), tail[0]);
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
    // An aptitude range that sits below where you already are would be nonsense.
    for (const id of exports.ABILITY_IDS)
        apt[id] = abClamp(apt[id], bg.base[id] + 2, exports.ABILITY_MAX);
    return { aptitude: apt, bands };
}
function makeAbilities(rng, backgroundId) {
    const bg = exports.BACKGROUND_ABILITIES[backgroundId] || exports.BACKGROUND_ABILITIES.STAFF;
    const { aptitude, bands } = rollAptitude(rng, backgroundId);
    const value = {};
    const xp = {};
    for (const id of exports.ABILITY_IDS) {
        // A couple of points of noise so two staffers are not identical.
        value[id] = abClamp(bg.base[id] + Math.round(rng.range(-3, 3)), exports.ABILITY_MIN, exports.ABILITY_MAX);
        xp[id] = 0;
    }
    return { value, aptitude, bands, xp, dp: 0, history: {}, spent: 0 };
}
// ── Cost curve ──────────────────────────────────────────────────────────────
// Cheap while developing, expensive at the top, and doubled once you are working past
// your natural range — expensive, never forbidden. This is how a player comes to feel
// where their aptitude sits without ever being shown the number.
function costToRaise(ab, id) {
    const v = ab.value[id];
    if (v >= exports.ABILITY_MAX)
        return null; // hard cap
    let c = v < 50 ? 1 : v < 60 ? 2 : v < 70 ? 3 : 4;
    if (v >= ab.aptitude[id])
        c *= 2;
    if (hasMomentum(ab, id))
        c = Math.max(1, c - 1); // recent experience discounts the next point
    return c;
}
exports.MOMENTUM_THRESHOLD = 3;
function hasMomentum(ab, id) { return (ab.xp[id] || 0) >= exports.MOMENTUM_THRESHOLD; }
// What the profile screen may say about difficulty. Never states the number.
function growthHint(ab, id) {
    const v = ab.value[id];
    if (v >= exports.ABILITY_MAX)
        return 'There is nothing left to learn here.';
    if (v >= ab.aptitude[id] + 6)
        return 'You are working a long way past what comes naturally to you. It can be done. It costs years.';
    if (v >= ab.aptitude[id])
        return 'You are past the range this comes to you easily. Every further step is expensive.';
    if (v >= ab.aptitude[id] - 5)
        return 'You are near the top of what comes naturally here.';
    return hasMomentum(ab, id) ? 'Recent experience is making this easier.' : 'There is room here.';
}
function raise(ab, id, times = 1) {
    for (let i = 0; i < times; i++) {
        const c = costToRaise(ab, id);
        if (c === null || ab.dp < c)
            return false;
        ab.dp -= c;
        ab.spent += c;
        ab.value[id] = abClamp(ab.value[id] + 1, exports.ABILITY_MIN, exports.ABILITY_MAX);
        if (hasMomentum(ab, id))
            ab.xp[id] = Math.max(0, ab.xp[id] - exports.MOMENTUM_THRESHOLD);
    }
    return true;
}
// ── Experience ──────────────────────────────────────────────────────────────
// Experience comes from doing political things, and losing is doing a political thing.
// It is never awarded for choosing a morally approved option — only for the kind of
// work the beat involved.
function addExperience(ab, tags, label) {
    for (const id of tags) {
        if (!exports.ABILITY_IDS.includes(id))
            continue;
        ab.xp[id] = (ab.xp[id] || 0) + 1;
        (ab.history[id] ||= []).push(label);
        if (ab.history[id].length > 6)
            ab.history[id].shift();
    }
    return ab;
}
function grantPoints(ab, n, reason) {
    ab.dp += n;
    (ab.history._grants ||= []).push({ n, reason });
    return ab;
}
// ── Checks ──────────────────────────────────────────────────────────────────
// Execution quality, not moral quality. The player picked the strategy; this decides
// how well the politician pulls it off. Deterministic from the supplied rng.
function check(ab, id, dc, rng, opts = {}) {
    const pressure = opts.pressure || 0; // crisis beats raise the bar
    const relief = Math.round(((ab.value.STRAT - 50) / 10) * 2); // Strategy steadies you
    const effDc = dc + pressure - Math.max(0, relief) * (pressure > 0 ? 1 : 0);
    // Wider noise than the ability gap so execution reads as a performance rather than a
    // lookup: a merely competent speaker can still have a good night, and a strong one a bad one.
    const margin = ab.value[id] - effDc + Math.round(rng.range(-16, 16));
    const grade = margin >= 10 ? 'excellent' : margin >= 0 ? 'solid' : margin >= -12 ? 'poor' : 'botched';
    const scale = { excellent: 1.35, solid: 1.05, poor: 0.65, botched: 0.35 }[grade];
    return { grade, margin, scale, effDc, ok: margin >= 0 };
}
// Strategy buys information, not win probability. Same election either way; a
// well-advised campaign simply knows more about what it is walking into.
function forecastText(ab, share, turnoutShare) {
    const s = ab.value.STRAT;
    const band = share > 0.56 ? 'STRONG' : share > 0.505 ? 'COMPETITIVE'
        : share > 0.45 ? 'UNDERDOG' : 'LONG SHOT';
    if (s < 45)
        return { band, detail: null };
    if (s < 58)
        return { band, detail: 'Your campaign thinks it is closer than the mood in the room suggests.' };
    const side = share >= 0.5 ? 'narrowly ahead' : 'slightly behind';
    return { band, detail: `Your team puts you ${side}. They believe turnout among unaligned voters is the main uncertainty, and that roughly ${Math.round(turnoutShare * 100)}% of the electorate will actually vote.` };
}
// Organization turns money and party standing into an actual field operation.
function mobilisationMultiplier(ab) {
    return abClamp(0.45 + (ab.value.ORG - 40) * 0.030, 0.45, 1.85);
}
// Communication decides how quickly the public comes to know who you are.
function recognitionGain(ab, base) {
    return base * abClamp(0.5 + (ab.value.COMM - 40) * 0.02, 0.5, 1.6);
}
// Negotiation discounts what party support costs you.
function negotiationDiscount(ab) {
    return abClamp(1.25 - (ab.value.NEG - 40) * 0.012, 0.55, 1.25);
}
function meets(ab, req) {
    if (!req)
        return true;
    for (const [id, v] of Object.entries(req))
        if ((ab.value[id] ?? 0) < v)
            return false;
    return true;
}
function unmetReason(ab, req) {
    for (const [id, v] of Object.entries(req || {})) {
        if ((ab.value[id] ?? 0) < v) {
            const a = exports.ABILITIES.find((x) => x.id === id);
            return `${a ? a.name : id} ${ab.value[id]} — this needs about ${v}.`;
        }
    }
    return null;
}
// ── Diegetic development ────────────────────────────────────────────────────
// The player never allocates points. They choose where a stretch of their life goes,
// and the arithmetic happens underneath. A primary focus takes most of the period; a
// secondary gets whatever evenings are left.
//
// What the player sees afterwards is how much came back out of the work, which is the
// only honest way to communicate natural aptitude: pouring two years into something you
// have no feel for visibly returns almost nothing.
function splitBudget(total) {
    const primary = Math.max(1, Math.ceil(total * 0.65));
    return { primary, secondary: Math.max(0, total - primary) };
}
function spendUpTo(ab, id, budget) {
    const from = ab.value[id];
    let left = budget, guard = 0;
    while (left > 0 && guard++ < 40) {
        const c = costToRaise(ab, id);
        if (c === null || c > left)
            break;
        const before = ab.value[id];
        ab.dp += c; // the focus screen supplies its own budget
        raise(ab, id);
        if (ab.value[id] === before) {
            ab.dp -= c;
            break;
        }
        left -= c;
    }
    return { from, to: ab.value[id], gained: ab.value[id] - from, spent: budget - left };
}
// How the years felt. This is the aptitude reveal, in prose, without a number.
function focusOutcomeText(gained, spent) {
    if (spent === 0)
        return 'There was not really time for it.';
    if (gained === 0)
        return 'The work went in. Very little came back out.';
    if (gained === 1)
        return 'Slow going, but something stuck.';
    if (gained === 2)
        return 'It came along steadily.';
    return 'It came easily. Some things do.';
}
function applyFocus(ab, primaryId, secondaryId, total) {
    const { primary, secondary } = splitBudget(total);
    const byId = (fid, list) => list.find((f) => f.id === fid);
    const out = { primary: null, secondary: null };
    const carry = ab.dp;
    ab.dp = 0;
    if (primaryId)
        out.primary = { focus: primaryId, ...spendUpTo(ab, primaryId, primary) };
    if (secondaryId && secondary > 0)
        out.secondary = { focus: secondaryId, ...spendUpTo(ab, secondaryId, secondary) };
    ab.dp = carry; // unspent milestone budget does not bank; only prior carry survives
    return out;
}

}],
"src/election.mjs": [{"./engine.mjs":"src/engine.mjs","./det-math.mjs":"src/det-math.mjs","./abilities.mjs":"src/abilities.mjs"}, function(module, exports, require) {
"use strict";
// Political Mirror — the single election reality.
//
// Every consumer builds elections through this module: the browser UI, the scripted
// playthrough, the matrix sweep, the seed hunters and the tests. There is no second copy.
//
// Why this file exists: between v0.35 and v0.37 the UI carried its own paste of the
// election formula. It drifted three versions behind — pre-v0.36 home advantage, no
// recognition term, an older mobilisation cap — so every balance number produced by the
// headless tools described a game nobody could play. A missing field then produced a NaN
// that silently collapsed turnout to zero. Both failures are structural, and both are
// fixed by there being exactly one implementation and one config.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RIVAL_PROFILES = exports.ELECTION_CONFIG = void 0;
exports.rollRival = rollRival;
exports.retrospective = retrospective;
exports.homeAdvantage = homeAdvantage;
exports.mobilisation = mobilisation;
exports.buildElectionSpec = buildElectionSpec;
exports.validateElectionSpec = validateElectionSpec;
exports.validateElectionResult = validateElectionResult;
exports.holdElection = holdElection;
const engine_mjs_1 = require("./engine.mjs");
const det_math_mjs_1 = require("./det-math.mjs");
const abilities_mjs_1 = require("./abilities.mjs");
const cl = (x, a, b) => Math.max(a, Math.min(b, x));
// ── Configuration ───────────────────────────────────────────────────────────
// Named and versioned. Tools must not shadow these with private constants; a sweep that
// wants different values passes an override object into the same functions.
exports.ELECTION_CONFIG = {
    id: 'pm-election-config',
    version: '0.37.1',
    // opponent
    rivalOffset: 0.30, // how strong the field is in general
    rivalArcJitter: 0.22,
    rivalPushMin: 0.0,
    rivalPushMax: 0.12,
    // the player's local advantage — earned, not granted
    homeBase: 0.03,
    homeStandingWeight: 0.030,
    homeFundsWeight: 0.012,
    homeTookSeatBonus: 0.06,
    homeTier1Cap: 0.30,
    homeTier2StandingWeight: 0.024,
    homeTier2Cap: 0.20,
    // the opponent's local advantage
    rivalHomeTier1: 0.10,
    rivalHomeTier2: 0.20,
    // the field operation: money and party standing, multiplied by Organization
    fundsWeight: 0.014,
    standingWeight: 0.020,
    mobilisationCapTier1: 0.32, // a ward race is a turnout game
    mobilisationCapTier2: 0.26,
    // retrospective record
    retroCapitalScale: 9,
    retroCapitalWeight: 0.28,
    retroCulvertFunded: 0.20,
    retroCulvertPartial: 0.05,
    retroCulvertFailed: -0.14,
    retroChoseSurvival: 0.18,
    retroChoseNeed: -0.16,
    retroTipBackfired: -0.16,
    retroComebackLocal: 0.20,
    retroComebackOther: 0.13,
    baseRecognition: 0.50,
    rivalRecognition: 0.50,
    rivalBaseRetro: 0.05,
    playerIdeology: 0.05,
    rivalIdeology: -0.10,
};
exports.RIVAL_PROFILES = [
    { id: 'CLEAN', integrity: 0.62, competence: -0.22 },
    { id: 'EFFECTIVE', integrity: -0.32, competence: 0.66 },
    { id: 'STRONG', integrity: 0.34, competence: 0.38 },
    { id: 'WEAK', integrity: -0.06, competence: -0.10 },
];
// ── The opponent's career ───────────────────────────────────────────────────
// Rolled once per world from the world RNG. Both consumers must call this, in this
// order, or their worlds diverge before a single vote is cast.
function rollRival(wr, cfg = exports.ELECTION_CONFIG) {
    const push = wr.range(cfg.rivalPushMin, cfg.rivalPushMax);
    const profile = exports.RIVAL_PROFILES[wr.int(exports.RIVAL_PROFILES.length)];
    const arc = [];
    for (const age of [28, 30, 32, 34, 36, 38, 39]) {
        for (const trait of ['integrity', 'competence']) {
            const target = profile[trait] + cfg.rivalOffset + wr.range(-cfg.rivalArcJitter, cfg.rivalArcJitter);
            arc.push({ age, trait, implication: Math.max(-1, Math.min(1, target)) });
        }
    }
    return { profile, profileId: profile.id, arc, push };
}
// ── Spec ────────────────────────────────────────────────────────────────────
// Every numeric field is required and finite. Nothing is left to `?? 0` at the call site,
// because that is precisely how `rivalPush` went missing at tier 2.
function retrospective(st, cfg = exports.ELECTION_CONFIG) {
    const f = st.flags || {};
    const comebackRoute = st.out?.route || st.lastOutRoute;
    const wildCredit = f.CAME_BACK
        ? (comebackRoute === 'LOCAL' ? cfg.retroComebackLocal : cfg.retroComebackOther) : 0;
    return cfg.retroCapitalWeight * (0, det_math_mjs_1.detTanh)((st.capital || 0) / cfg.retroCapitalScale)
        + wildCredit
        + (f.CULVERT_FUNDED ? cfg.retroCulvertFunded
            : f.CULVERT_PARTIAL ? cfg.retroCulvertPartial : cfg.retroCulvertFailed)
        + (f.CHOSE_SURVIVAL ? cfg.retroChoseSurvival : f.CHOSE_NEED ? cfg.retroChoseNeed : 0)
        + (f.TIP_BACKFIRED ? cfg.retroTipBackfired : 0);
}
function homeAdvantage(st, tier, cfg = exports.ELECTION_CONFIG) {
    if (tier === 1) {
        return cl(cfg.homeBase + cfg.homeStandingWeight * (st.standing || 0)
            + cfg.homeFundsWeight * (st.funds || 0)
            + (st.flags?.TOOK_SEAT ? cfg.homeTookSeatBonus : 0), 0, cfg.homeTier1Cap);
    }
    return cl(cfg.homeTier2StandingWeight * (st.standing || 0), 0, cfg.homeTier2Cap);
}
function mobilisation(st, tier, cfg = exports.ELECTION_CONFIG) {
    const mult = st.abilities ? (0, abilities_mjs_1.mobilisationMultiplier)(st.abilities) : 1;
    const cap = tier === 1 ? cfg.mobilisationCapTier1 : cfg.mobilisationCapTier2;
    return cl(mult * (cfg.fundsWeight * (st.funds || 0) + cfg.standingWeight * (st.standing || 0)), 0, cap);
}
/**
 * The one place an election is described. `world` must carry { rivalPush, playerBloc,
 * rivalBloc, seedFor(label) }.
 */
function buildElectionSpec(st, beat, world, cfg = exports.ELECTION_CONFIG) {
    const tier = beat.tier;
    const rivalId = tier === 1 ? 'RIVAL1' : 'RIVAL2';
    const spec = {
        electionId: beat.id,
        age: beat.age,
        office: beat.office,
        officeTier: tier,
        seed: world.seedFor('election-' + beat.id),
        configVersion: cfg.version,
        rivalProfileId: world.rivalProfileId,
        rivalPush: world.rivalPush,
        playerBloc: world.playerBloc,
        opponentBloc: world.rivalBloc,
        candidates: [
            { id: 'PLAYER', bloc: world.playerBloc, ideology: cfg.playerIdeology,
                retro: retrospective(st, cfg),
                homeAdvantage: homeAdvantage(st, tier, cfg),
                recognition: Number.isFinite(st.recognition) ? st.recognition : cfg.baseRecognition },
            { id: rivalId, bloc: world.rivalBloc, ideology: cfg.rivalIdeology,
                retro: cfg.rivalBaseRetro + (tier === 2 ? world.rivalPush : 0),
                homeAdvantage: tier === 1 ? cfg.rivalHomeTier1 : cfg.rivalHomeTier2,
                recognition: cfg.rivalRecognition },
        ],
        ctx: { mobilisation: { PLAYER: mobilisation(st, tier, cfg) } },
    };
    validateElectionSpec(spec);
    return spec;
}
const NUMERIC_SPEC_FIELDS = ['age', 'officeTier', 'seed', 'rivalPush'];
const NUMERIC_CANDIDATE_FIELDS = ['ideology', 'retro', 'homeAdvantage', 'recognition'];
function validateElectionSpec(spec) {
    const where = (field) => `election "${spec.electionId}" (age ${spec.age}, tier ${spec.officeTier}, seed ${spec.seed}): ` +
        `${field} is not a finite number`;
    for (const f of NUMERIC_SPEC_FIELDS)
        if (!Number.isFinite(spec[f]))
            throw new Error(where(f) + ` — got ${spec[f]}`);
    if (!spec.playerBloc || !spec.opponentBloc)
        throw new Error(`election "${spec.electionId}": missing bloc identity`);
    if (!Array.isArray(spec.candidates) || spec.candidates.length !== 2)
        throw new Error(`election "${spec.electionId}": needs exactly two candidates`);
    for (const c of spec.candidates) {
        for (const f of NUMERIC_CANDIDATE_FIELDS)
            if (!Number.isFinite(c[f]))
                throw new Error(where(`${c.id}.${f}`) + ` — got ${c[f]}`);
        if (!c.bloc)
            throw new Error(`election "${spec.electionId}": ${c.id} has no bloc`);
    }
    const m = spec.ctx?.mobilisation?.PLAYER;
    if (!Number.isFinite(m))
        throw new Error(where('ctx.mobilisation.PLAYER') + ` — got ${m}`);
    return spec;
}
function validateElectionResult(res, spec) {
    const where = (field, v) => `election "${spec.electionId}" (age ${spec.age}, tier ${spec.officeTier}, seed ${spec.seed}): ` +
        `${field} is invalid — got ${v}`;
    if (!Number.isFinite(res.turnout))
        throw new Error(where('turnout', res.turnout));
    for (const c of spec.candidates) {
        const s = res.shares[c.id];
        if (!Number.isFinite(s))
            throw new Error(where(`shares.${c.id}`, s));
    }
    // A turnout of exactly zero across a whole electorate is the signature of a NaN that
    // got past the input checks. It is never a legitimate outcome here.
    if (res.turnout === 0)
        throw new Error(where('turnout', '0 — nobody voted, which means a NaN reached the utility function'));
    if (!res.winner)
        throw new Error(where('winner', res.winner));
    return res;
}
/** Build, validate, run, validate. The only supported way to hold an election. */
function holdElection(agents, st, beat, world, rng, cfg = exports.ELECTION_CONFIG) {
    const spec = buildElectionSpec(st, beat, world, cfg);
    const res = (0, engine_mjs_1.runElection)(agents, spec.candidates, rng(spec.seed), spec.ctx);
    validateElectionResult(res, spec);
    return { spec, res, won: res.winner === 'PLAYER' };
}

}],
"src/content.mjs": [{}, function(module, exports, require) {
"use strict";
// Political Mirror — vertical slice content.
// Latent parameters are declared per event. Matched pairs differ on EXACTLY one factor.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCRIPT = exports.ROUTE_ENTRY = exports.EARLY_SCRIPT = exports.CHAIN_TEXT = exports.CHAINS = exports.WILDERNESS_PAYOFF = exports.WILDERNESS_TEXT = exports.LIFE_FOCUS = exports.CAMPAIGN_XP = exports.DP_GRANTS = exports.XP_TAGS = exports.LADDER = exports.ROUTES = exports.OPP = exports.BLOCS = void 0;
exports.chainRecall = chainRecall;
exports.BLOCS = {
    CIV: { id: 'CIV', name: 'Civic Alliance', axis: 'Decisions belong close to the people affected by them.', color: 'ochre' },
    REN: { id: 'REN', name: 'Renewal Front', axis: 'A capable centre can move faster than a hundred committees.', color: 'indigo' },
};
const OPP = (b) => (b === 'CIV' ? 'REN' : 'CIV');
exports.OPP = OPP;
exports.ROUTES = [
    { id: 'STAFF', name: 'Legislative staffer', blurb: 'Six years drafting other people\'s bills. You know where the bodies are filed.',
        start: { capital: 3, funds: 4, standing: 5, mu: 0.15, tau: 0.55 } },
    { id: 'CIVIC', name: 'Community organiser', blurb: 'You ran a tenants\' union that beat the city twice. Nobody in the party owes you anything.',
        start: { capital: 4, funds: 1, standing: 1, mu: 0.45, tau: 0.4 } },
    { id: 'PROF', name: 'Municipal auditor', blurb: 'You spent your twenties finding money that had gone missing. Some of it belonged to your future colleagues.',
        start: { capital: 2, funds: 3, standing: 2, mu: 0.55, tau: 0.7 } },
];
// The four-point private ladder. Anchors locked at 0.15 / 0.40 / 0.60 / 0.85.
exports.LADDER = [
    ['There\'s nothing here. Someone is fishing.', 'Probably overblown, but I want to know more.',
        'I think it\'s real. I\'d want it confirmed.', 'It happened. We should assume it happened.'],
    ['Weak lead', 'Plausible', 'Likely true', 'Near certain'],
];
const F = (o) => ({ selfProtection: 0, proceduralRestraint: 0, concession: 0, deflection: 0,
    exploitation: 0, transparency: 0, institutionalCost: 0, electoralGain: 0, personalCost: 0, horizon: 0, ...o });
// ── The three delayed chains ────────────────────────────────────────────────
// Chain seeds are deliberately NOT matched-pair members: a pair member that
// resolved early would tell the player the answer before judging its partner.
exports.XP_TAGS = {
    HOUSING_REFORM: ['POLICY', 'COMM'], PARTY_WHIP: ['NEG'], THE_ERROR: ['COMM', 'POLICY'],
    ENTRY_23: ['POLICY'], FORMATIVE_24: ['ORG'],
    INTRO: ['STRAT'], CULVERT: ['POLICY'], OPP_CONTRACT: ['STRAT'],
    DISTRICTS: ['POLICY', 'STRAT'], CROWD_LOUD: ['COMM'], CROWD_QUIET: ['COMM'],
    TIP_HOUSING: ['STRAT'], GRANT_QUESTION: ['POLICY'], SMEAR_RIVAL: ['COMM'],
    RECORDING_DENIABLE: ['STRAT'], RECORDING_CLEAN: ['STRAT'],
    ALLY_CONTRACT: ['NEG'], AUDIT_OFFICE: ['NEG', 'POLICY'],
    PARTY_OFFER: ['NEG'], THE_ALLEGATION: ['COMM'], THE_TIP: ['STRAT'],
    WILDERNESS: ['STRAT'], COMEBACK: ['ORG', 'STRAT'],
    CHAIN_HOUSING: ['STRAT'], CHAIN_SMEAR: ['COMM'], CHAIN_GRANT: ['POLICY'],
};
// Development opportunities are SYMMETRIC. v0.35 gave a defeated player 5 points and a
// winner 4, and — worse — the loser then also got the wilderness milestone the winner
// never saw, so losing was worth 11 freely-allocatable points against 7. That made
// deliberate defeat a rational build strategy, which is the opposite of the intention.
//
// Now both paths get three milestones and the same total. What losing gives you instead
// is USE-BASED experience in the things a hard campaign actually exercises — which only
// discounts growth in those specific abilities, and cannot be spent anywhere else.
exports.DP_GRANTS = {
    FORMATIVE: { n: 3, reason: 'Before any of it started' },
    FIRST_CAMPAIGN: { n: 4, reason: 'Your first campaign' },
    FIRST_TERM: { n: 4, reason: 'Two years in the job' },
    WILDERNESS: { n: 4, reason: 'Four years out of office' },
    MIDCAREER: { n: 3, reason: 'A decade in politics' },
};
// What each path genuinely exercises. Losing a close race means you knocked more doors
// and spent more nights on the numbers; winning means you built something that held and
// now have to govern with people you need.
exports.CAMPAIGN_XP = {
    WON: { tags: ['ORG', 'NEG'], label: 'Won the ward' },
    LOST: { tags: ['ORG', 'ORG', 'STRAT', 'STRAT'], label: 'Lost the ward by four hundred votes' },
};
// ── Diegetic development: where the next stretch of a life goes ──
exports.LIFE_FOCUS = [
    { id: 'CONSTITUENCY', ability: 'ORG', label: 'The constituency',
        blurb: 'Surgeries every Saturday morning. The volunteer list. The streets nobody else knocks.' },
    { id: 'COMMITTEE', ability: 'POLICY', label: 'The committee corridor',
        blurb: 'Bills, briefings, and the detail almost nobody else in the chamber has read.' },
    { id: 'PLATFORM', ability: 'COMM', label: 'The studio and the platform',
        blurb: 'Interviews, panels, debates. Learning to make an argument stand up in ninety seconds.' },
    { id: 'CHAMBER_BAR', ability: 'NEG', label: 'The bar off the chamber',
        blurb: 'The people whose votes you will need one day, and what each of them actually wants.' },
    { id: 'BACKROOM', ability: 'STRAT', label: 'The back room',
        blurb: 'Polling, ward maps, and the long unglamorous business of working out where this is going.' },
];
exports.WILDERNESS_TEXT = {
    PROFESSIONAL: 'Two years of work that closes at six o\'clock. You are better paid than you have ever been and nobody asks your opinion about anything. Twice a year someone recognises you in a queue and cannot place where from.',
    STAFF: 'Two years of other people\'s campaigns. You write the lines, you book the halls, you learn exactly how the nominations are actually decided. Everyone in the building knows your name and no one outside it does.',
    MEDIA: 'Two years of the panel show and the Thursday column. You are recognised constantly now, and about half the people who recognise you have already decided what you are. The invitations come from one side only.',
    LOCAL: 'Two years of school fetes, drainage meetings and the funeral of anyone who mattered. It is unglamorous and slow and there are four thousand people who would now put your leaflet in their window without being asked.',
    LEAVE: 'Two years of not being a politician. It is remarkable, and slightly insulting, how completely a city forgets a person who stops appearing in it. The old scandal stops coming up because nothing about you comes up.',
};
// Four years out of office has to build something, or defeat is a death spiral rather
// than a chapter. Each route earns a different kind of standing with the electorate.
exports.WILDERNESS_PAYOFF = {
    PROFESSIONAL: { trait: 'competence', implication: 0.6, strength: 0.8, reliability: 0.9,
        diagnosticity: 0.55, mediaReach: 0.35 },
    STAFF: { trait: 'competence', implication: 0.55, strength: 0.75, reliability: 0.88,
        diagnosticity: 0.5, mediaReach: 0.3 },
    MEDIA: { trait: 'competence', implication: 0.68, strength: 0.85, reliability: 0.85,
        diagnosticity: 0.6, mediaReach: 0.9 },
    LOCAL: { trait: 'integrity', implication: 0.82, strength: 0.9, reliability: 0.92,
        diagnosticity: 0.7, mediaReach: 0.45 },
    LEAVE: { trait: 'competence', implication: 0.3, strength: 0.3, reliability: 0.7,
        diagnosticity: 0.4, mediaReach: 0.15 },
};
exports.CHAINS = {
    HOUSING: { seedId: 'TIP_HOUSING', outcome: 'CONFIRMED', seedAge: 30,
        file: 'THE NORTHGATE HOUSING FILE', reporter: 'Mara Venn',
        returnLine: 'Mara Venn returns with procurement documents released under appeal.' },
    SMEAR: { seedId: 'SMEAR_RIVAL', outcome: 'DISPROVEN', seedAge: 33,
        file: 'THE QUALIFICATIONS DOSSIER', reporter: 'Ilse Brandt',
        returnLine: 'Ilse Brandt, who first ran the dossier, files a retraction longer than the original story.' },
    GRANT: { seedId: 'GRANT_QUESTION', outcome: 'UNRESOLVED', seedAge: 31,
        file: 'THE MERIDIAN CULTURAL GRANT', reporter: 'the standing inquiry',
        returnLine: 'The standing inquiry into the cultural grant finally reports.' },
};
// What the player is reminded of, in their own record, before any verdict.
function chainRecall(spec, credence, move) {
    const said = credence === null || credence === undefined ? null
        : ['you thought there was nothing in it', 'you thought it was probably overblown',
            'you thought it was probably real', 'you were sure it had happened'][credence];
    return {
        file: spec.file,
        header: `${spec.seedAge === 30 ? 'Five' : spec.seedAge === 31 ? 'Eight' : 'Four'} years ago`,
        line: said ? `At ${spec.seedAge}, ${said}.` : `At ${spec.seedAge}, this crossed your desk.`,
        did: move?.label ?? null,
    };
}
exports.CHAIN_TEXT = {
    HOUSING: (v) => ({
        head: 'Confirmed, five years late',
        body: 'The bank records surface in an unrelated bankruptcy filing. The housing officer took four payments across eighteen months, and the unsigned letter that reached your office at thirty had the dates right.',
        verdict: v.tone === 'wrong'
            ? 'You were wrong, and you were wrong early and in writing. A reporter finds the minute where you said so.'
            : v.procedural > 0.5
                ? 'You did not announce a conclusion. You asked for it to be looked at, and it was, and it was there. Almost nobody notices. One person writes about it.'
                : 'You called it before anyone could prove it. That reads as judgment, or as luck, depending on who is describing you.',
    }),
    SMEAR: (v) => ({
        head: 'The dossier was manufactured',
        body: 'The qualifications dossier was forged — competently, by a former campaign contractor with a grudge and a scanner, who confesses in a civil suit two years later. Every document in it was fabricated.',
        verdict: v.tone === 'wrong'
            ? 'You believed it, and some of what you did assumed it was true. The correction travels a fraction as far as the accusation did.'
            : v.procedural > 0.5
                ? 'You declined to treat it as established before it was established. In hindsight that was the only sensible thing anyone did with it.'
                : 'You did not take the bait. Nobody thanks you, because nothing happened.',
    }),
    GRANT: () => ({
        head: 'Closed without a finding',
        body: 'The inquiry into the cultural grant reports after six years. It cannot establish that the foundation received favourable treatment. It also cannot establish that it did not. Two of the three relevant officials have retired; the third declines to be interviewed.',
        verdict: 'Nothing is settled and nothing will be. The people who were certain at the time are still certain, in both directions, and the file goes into storage.',
    }),
};
// ─── The event script. Ages drive pacing; quiet years compress between beats. ───
const RAW_SCRIPT = (P) => [
    {
        id: 'INTRO', age: 26, kind: 'story', chapter: 'Entry',
        title: 'The ward that nobody wanted',
        text: `${P.region} has forty thousand people, one flooding culvert, and a council seat the ${exports.BLOCS[P.bloc].name} has lost three times running. The regional secretary offers it to you over bad coffee. "You'd be doing us a favour," she says, which means she expects you to lose.`,
        choices: [
            { id: 'take', flag: 'TOOK_SEAT', label: 'Take the seat. Losing in public is still being in public.',
                features: F({ electoralGain: 0.6, horizon: 0.5 }), effect: { capital: 1 } },
            { id: 'bargain', label: 'Take it \u2014 and make her fund it properly first.',
                features: F({ electoralGain: 0.4, selfProtection: 0.3 }), effect: { funds: 3, standing: -1 } },
            { id: 'wait', label: 'Decline. Ask for the safer ward next cycle.',
                features: F({ selfProtection: 0.7, horizon: 0.3 }), effect: { standing: 2, funds: 1, capital: -1 } },
        ],
    },
    {
        id: 'CULVERT', age: 27, kind: 'story', chapter: 'Entry', responsibility: false,
        title: 'The culvert',
        text: 'The flooding culvert has been in the budget for nine years and out of it for nine years. Fixing it costs everything you can raise. Announcing you will fix it costs nothing and polls beautifully.',
        choices: [
            { id: 'fund', label: 'Spend the whole ward fund on the culvert.', features: F({ transparency: 0.4, horizon: 0.9, electoralGain: -0.2 }), effect: { funds: -3, capital: 2 }, flag: 'CULVERT_FUNDED' },
            { id: 'announce', label: 'Announce a plan. Fund a study.', features: F({ deflection: 0.6, electoralGain: 0.7, horizon: -0.3 }), effect: { capital: 1, funds: 3, standing: 1 } },
            { id: 'split', label: 'Fix the worst hundred metres. Say so plainly.', features: F({ transparency: 0.7, concession: 0.3, horizon: 0.4 }), effect: { funds: -1 }, flag: 'CULVERT_PARTIAL' },
        ],
    },
    // ── MATCHED PAIR A, member 1: opposing-side target ──
    {
        id: 'OPP_CONTRACT', age: 28, kind: 'judgment', chapter: 'First term',
        factor: 'PARTISAN', pairId: 'P1', level: 'OPPOSING_SIDE', readFormat: 0,
        title: 'A contract on the other side',
        text: `A ${exports.BLOCS[(0, exports.OPP)(P.bloc)].name} councillor's brother-in-law won the waste-collection contract for the eastern districts. The procurement file shows two bidders and one very short evaluation window. The councillor says the process was clean and the family connection is a coincidence.`,
        readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
        latents: { implication: -0.62, strength: 0.62, reliability: 0.68, diagnosticity: 0.75, deniability: 0.2,
            targetSide: 'OPPOSING_SIDE', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.7 },
        choices: [
            { id: 'demand', label: 'Call for the councillor to stand down while it is investigated.', features: F({ exploitation: 0.7, electoralGain: 0.6, proceduralRestraint: 0.2 }), effect: { capital: 1, standing: 1, funds: 1 } },
            { id: 'refer', cost: { capital: 2 }, lockNote: 'You have no standing left to spend on asking the Audit Office for favours.', label: 'Refer the file to the Audit Office and say nothing else.', features: F({ proceduralRestraint: 0.85, transparency: 0.5, horizon: 0.4 }), effect: { capital: 1 }, institutional: true },
            { id: 'quiet', label: 'Leave it. Waste contracts are always ugly.', features: F({ deflection: 0.7, horizon: 0.2 }), effect: {} },
        ],
    },
    { id: 'ELECTION_1', age: 29, kind: 'election', chapter: 'First term', office: 'Ward Council', tier: 1 },
    // Loss branch — political failure must not be game failure.
    {
        id: 'WILDERNESS', age: 30, kind: 'story', chapter: 'Out', when: (st) => !st.office,
        title: 'Out',
        text: 'You lost by four hundred votes. The party stops returning calls within a fortnight. There is no ceremony to losing a ward seat — the office is cleared by the end of the month and the phone simply goes quiet.',
        prompt: 'Four years is a long time. What do you do with them?',
        choices: [
            { id: 'professional', label: 'Go back to the profession. Earn properly for a while.',
                features: F({ selfProtection: 0.4, horizon: -0.1 }),
                effect: { funds: 7 }, flag: 'OUT_PROFESSIONAL',
                out: { route: 'PROFESSIONAL', fade: 2.5, recognition: -0.14, independence: +0.2,
                    note: 'You are solvent and nobody can reach you for comment.' } },
            { id: 'staff', label: 'Take a job inside the party machine. Be owed things.',
                features: F({ selfProtection: 0.35, electoralGain: 0.5 }),
                effect: { standing: 6, funds: 2 }, flag: 'OUT_STAFF',
                out: { route: 'STAFF', fade: 1.0, recognition: -0.04, independence: -0.35,
                    note: 'The nomination will be easier next time. It will also be theirs to give.' } },
            { id: 'media', label: 'Take the column and the panel slot. Be visible.',
                features: F({ exploitation: 0.35, transparency: 0.3 }),
                effect: { funds: 3 }, flag: 'OUT_MEDIA',
                out: { route: 'MEDIA', fade: 0.0, recognition: +0.26, independence: +0.1, hardens: true,
                    note: 'Everyone knows who you are now. Half of them have decided what you are.' } },
            { id: 'local', label: 'Stay in the ward. Turn up to everything for four years.',
                features: F({ horizon: 0.8, transparency: 0.5 }),
                effect: { capital: 4, standing: 1 }, flag: 'OUT_LOCAL',
                out: { route: 'LOCAL', fade: 0.8, recognition: +0.06, independence: +0.15, local: true,
                    note: 'Nobody in the capital notices. Four thousand people in the ward do.' } },
            { id: 'leave', label: 'Leave politics. Properly, as far as you know.',
                features: F({ deflection: 0.4, horizon: -0.2 }),
                effect: { funds: 5, capital: 1 }, flag: 'OUT_LEAVE',
                out: { route: 'LEAVE', fade: 4.0, recognition: -0.30, independence: +0.3,
                    note: 'It is remarkable how completely the city forgets a person who stops appearing in it.' } },
        ],
    },
    {
        id: 'WILDERNESS_MID', age: 32, kind: 'wilderness', chapter: 'Out', when: (st) => !!st.out,
        title: 'The middle of it',
    },
    {
        id: 'FIRST_TERM', age: 32, kind: 'milestone', chapter: 'Council', when: (st) => !!st.office,
        title: 'Two years in',
        grant: 'FIRST_TERM',
        text: 'Two years of committee papers, ward surgeries and votes you did not get to choose. You have worked out which parts of this job you are actually good at, and which parts you have been getting away with.',
    },
    {
        id: 'COMEBACK', age: 34, kind: 'story', chapter: 'Out', when: (st) => !!st.out,
        title: 'The seat comes open',
        text: 'The member who beat you is moving to a national list. The ward selection is open, and your name comes up in the meeting — not first, but it comes up.',
        prompt: 'Do you go back?',
        choices: [
            { id: 'run', label: 'Put your name in. You have been waiting four years to be asked.',
                features: F({ electoralGain: 0.6, horizon: 0.4 }), effect: { capital: 1 }, flag: 'COMEBACK_RUN' },
            { id: 'run_field', requires: { ORG: 55 }, check: { ability: 'ORG', dc: 52 },
                label: 'Put your name in, and win it on the doorstep — four hundred volunteers and no money at all.',
                features: F({ horizon: 0.6, electoralGain: 0.5, transparency: 0.4 }),
                effect: { capital: 2, standing: 1 }, flag: 'COMEBACK_RUN' },
            { id: 'run_hard', label: 'Put your name in, and make sure the other candidates hear about it first.',
                features: F({ exploitation: 0.55, electoralGain: 0.75 }), effect: { standing: 2 }, flag: 'COMEBACK_RUN' },
            { id: 'decline', label: 'Not this one. Wait for something that is actually yours.',
                features: F({ selfProtection: 0.5, horizon: 0.5 }), effect: { funds: 2 }, flag: 'COMEBACK_DECLINE' },
        ],
    },
    // ── CHAIN A seed: doubted \u2192 later CONFIRMED ──
    {
        id: 'TIP_HOUSING', age: 30, kind: 'judgment', chapter: 'First term', chainSeed: 'HOUSING', readFormat: 1,
        title: 'An unsigned letter',
        text: 'Mara Venn at the Northgate Record has been asking about the housing allocations for a month. An unsigned letter reaches your office claiming the district housing officer has been taking payments to move families up the allocation list. It names no dates and attaches no documents. It does name three families, and two of them did move up the list.',
        readPrompt: 'Mark your internal confidence for the file. Nobody outside this room sees it.',
        latents: { implication: -0.6, strength: 0.35, reliability: 0.4, diagnosticity: 0.7, deniability: 0.3,
            targetSide: 'NON_PARTISAN', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.3 },
        choices: [
            { id: 'push', label: 'Take it to the press. Let the pressure do the work.', features: F({ exploitation: 0.75, electoralGain: 0.5 }), effect: { capital: 1 } },
            { id: 'refer', label: 'Ask the Audit Office to look at the allocation list quietly.', features: F({ proceduralRestraint: 0.85, horizon: 0.5 }), effect: {}, institutional: true },
            { id: 'bin', label: 'Anonymous letters are how people settle scores. Bin it.', features: F({ deflection: 0.7 }), effect: {} },
        ],
    },
    // ── CHAIN C seed: never definitively resolves ──
    {
        id: 'GRANT_QUESTION', age: 31, kind: 'judgment', chapter: 'Council', chainSeed: 'GRANT', readFormat: 0,
        title: 'The cultural grant',
        text: 'The standing inquiry into regional grants opens a file the same week. A foundation with a board full of familiar surnames received the largest cultural grant in the region\u2019s history. The scoring sheet exists, is signed, and awards them four points more than the runner-up on \u201cinstitutional capacity\u201d. Nobody can say what that means.',
        readPrompt: 'Your chief of staff shuts the door. \u201cOff the record. What do you actually think happened?\u201d',
        latents: { implication: -0.5, strength: 0.45, reliability: 0.6, diagnosticity: 0.55, deniability: 0.35,
            targetSide: 'NON_PARTISAN', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.5 },
        choices: [
            { id: 'demand', label: 'Demand the grant be revoked and rescored.', features: F({ exploitation: 0.6, electoralGain: 0.45 }), effect: { capital: 1, standing: -1 } },
            { id: 'inquiry', label: 'Call for a formal inquiry and wait for it.', features: F({ proceduralRestraint: 0.85, horizon: 0.6 }), effect: {}, institutional: true },
            { id: 'shrug', label: 'Every scoring sheet has a soft criterion. Let it go.', features: F({ deflection: 0.65 }), effect: {} },
        ],
    },
    {
        id: 'DISTRICTS', age: 31, kind: 'story', tradeoff: true, when: (st) => !!st.office, chapter: 'Council', temptation: true,
        title: 'Two districts, one budget',
        text: 'The renewal fund covers one district. The northern district has the worse flooding, the older pipes and the smaller turnout. The southern district decides your re-election. Both allocations are entirely legal and both have a written case.',
        choices: [
            { id: 'need', label: 'North. The need is measurable and the case is on paper.', features: F({ transparency: 0.6, horizon: 0.8, electoralGain: -0.6 }), effect: { capital: 2, funds: -1, standing: -1 }, flag: 'CHOSE_NEED', stakes: { core: -0.32, ind: 0.22, publicSector: 0.15 } },
            { id: 'survive', label: 'South. You cannot fix anything from outside the chamber.', features: F({ electoralGain: 0.85, selfProtection: 0.5, horizon: -0.2 }), effect: { funds: 3, standing: 2 }, flag: 'CHOSE_SURVIVAL', stakes: { core: 0.35, ind: -0.22, owner: 0.12 } },
            { id: 'split', label: 'Split it. Half a fix in both places.', features: F({ deflection: 0.4, concession: 0.2, electoralGain: 0.2 }), effect: { funds: 1 }, flag: 'CHOSE_SPLIT', stakes: { core: 0.05, ind: -0.05 } },
        ],
    },
    // ── MATCHED PAIR B, member 1: loud crowd ──
    {
        // TRADE-OFF 1 — good policy, bad politics. Owners lose, renters gain, and no option
        // is clean. Communication changes how badly it lands; it cannot make the loss vanish.
        id: 'HOUSING_REFORM', age: 31, kind: 'story', chapter: 'Council', when: (st) => !!st.office,
        tradeoff: true, responsibility: true,
        title: 'The density map',
        text: 'The ward has four thousand people on the housing list and a planning rule that has not changed since 1974. Lifting it would put three hundred new flats on the eastern approach within four years. It would also put them behind eleven hundred houses whose owners have spent thirty years believing that view was part of what they bought.',
        prompt: 'The vote is yours to lead or to bury.',
        choices: [
            { id: 'full', label: 'Lead it. Full rezoning, and stand up at the meeting to defend it.',
                features: F({ transparency: 0.8, horizon: 0.9, personalCost: 0.8, electoralGain: -0.7 }),
                check: { ability: 'COMM', dc: 58 }, effect: { capital: 1 },
                stakes: { owner: -0.55, young: 0.45, business: 0.15, core: -0.1 },
                signal: { implication: 0.35, trait: 'competence', strength: 0.7 }, flag: 'HOUSING_FULL' },
            { id: 'phased', label: 'Phase it over eight years so the first tranche lands after the election.',
                features: F({ horizon: 0.5, deflection: 0.3, electoralGain: 0.2, proceduralRestraint: 0.3 }),
                check: { ability: 'POLICY', dc: 55 }, effect: { capital: 1 },
                stakes: { owner: -0.2, young: 0.15 },
                signal: { implication: 0.12, trait: 'competence', strength: 0.5 }, flag: 'HOUSING_PHASED' },
            { id: 'consult', label: 'Send it to consultation. Consultations take two years and produce a document.',
                features: F({ deflection: 0.8, selfProtection: 0.5, horizon: -0.4 }),
                effect: { standing: 1 },
                stakes: { owner: 0.25, young: -0.35 }, flag: 'HOUSING_BURIED' },
            { id: 'kill', label: 'Kill it and say plainly that you are protecting the character of the ward.',
                features: F({ electoralGain: 0.6, selfProtection: 0.4, horizon: -0.6, transparency: 0.4 }),
                effect: { standing: 4, funds: 5 },
                stakes: { owner: 0.5, young: -0.5, business: -0.1 }, flag: 'HOUSING_KILLED' },
        ],
    },
    {
        // TRADE-OFF 4 — party against principle. Negotiation decides what you get out of it,
        // not whether the conflict exists.
        id: 'PARTY_WHIP', age: 34, kind: 'story', chapter: 'Rising', tradeoff: true,
        title: 'A three-line whip',
        text: 'The bloc is going to vote for a procurement bill that removes the audit threshold on contracts under two million. You have read it twice. It is a bad bill and everyone privately knows it is a bad bill; it is also the price of a housing package your ward has waited six years for.',
        prompt: 'The whip wants an answer before six.',
        choices: [
            { id: 'rebel', label: 'Vote against it and say why on the record.',
                features: F({ transparency: 0.85, proceduralRestraint: 0.6, personalCost: 0.8, electoralGain: -0.3 }),
                effect: { standing: -4, capital: 1 }, check: { ability: 'COMM', dc: 55 },
                stakes: { core: -0.15, ind: 0.2, publicSector: 0.2 }, flag: 'REBELLED' },
            { id: 'trade', label: 'Trade your vote — support it, and take the housing package in writing.',
                features: F({ proceduralRestraint: 0.2, institutionalCost: 0.45, horizon: 0.55, electoralGain: 0.4 }),
                effect: { standing: 3, capital: 2 }, check: { ability: 'NEG', dc: 56 },
                stakes: { core: 0.2, young: 0.22, publicSector: -0.28, ind: -0.15 }, flag: 'TRADED_VOTE' },
            { id: 'abstain', label: 'Abstain, and let it pass without your name on it.',
                features: F({ deflection: 0.8, selfProtection: 0.6, institutionalCost: 0.25 }),
                effect: { standing: -1 }, stakes: { ind: -0.14, core: -0.12, publicSector: 0.08 }, flag: 'ABSTAINED' },
            { id: 'support', label: 'Vote for it and defend it in public as a sensible simplification.',
                features: F({ selfProtection: 0.4, institutionalCost: 0.6, electoralGain: 0.35, deflection: 0.5 }),
                effect: { standing: 6, funds: 4 }, check: { ability: 'COMM', dc: 52 },
                stakes: { core: 0.15, publicSector: -0.25 }, flag: 'WHIPPED' },
        ],
    },
    {
        // TRADE-OFF 5 — your own administration's error. Concealment can genuinely work; the
        // seed decided years ago whether it surfaces, so this is not karma.
        id: 'THE_ERROR', age: 36, kind: 'story', chapter: 'Rising', tradeoff: true,
        responsibility: true, when: (st) => !!st.office,
        title: 'Nine months of the wrong number',
        text: 'Your office has been publishing a school-meals uptake figure that is wrong. Not fraudulently wrong — a spreadsheet inherited from the previous administration double-counted a category — but you have cited it four times, including once to justify a budget you won. Three people know. The press does not.',
        prompt: 'Nobody is going to make this decision for you.',
        choices: [
            { id: 'disclose', label: 'Publish the correction today, with the four occasions you used it listed.',
                features: F({ transparency: 0.95, concession: 0.8, personalCost: 0.8, electoralGain: -0.4 }),
                check: { ability: 'COMM', dc: 56 }, effect: {},
                stakes: { ind: 0.25, publicSector: 0.2, core: -0.3 },
                signal: { implication: -0.28, trait: 'competence', strength: 0.6 }, flag: 'ERROR_DISCLOSED' },
            { id: 'audit', label: 'Have the audit office look at it first, then publish whatever they find.',
                features: F({ proceduralRestraint: 0.85, transparency: 0.5, horizon: 0.5 }),
                cost: { capital: 2 }, lockNote: 'You have nothing left to spend on asking the audit office for anything.',
                check: { ability: 'POLICY', dc: 54 }, stakes: { ind: 0.16, publicSector: 0.16, core: -0.14, opp: -0.1 }, flag: 'ERROR_AUDITED' },
            { id: 'quiet', label: 'Correct the figure quietly in the next routine release and say nothing.',
                features: F({ deflection: 0.7, selfProtection: 0.5, electoralGain: 0.2 }),
                effect: { funds: 3, standing: 2 }, stakes: {}, flag: 'ERROR_BURIED' },
            { id: 'blame', label: 'Correct it, and make clear it was inherited from the previous administration.',
                features: F({ selfProtection: 0.8, deflection: 0.6, exploitation: 0.4, electoralGain: 0.35 }),
                check: { ability: 'COMM', dc: 50 }, effect: { standing: 4, funds: 2 },
                stakes: { core: 0.2, opp: -0.2 }, flag: 'ERROR_BLAMED' },
        ],
    },
    {
        id: 'CROWD_LOUD', age: 32, kind: 'judgment', chapter: 'Council',
        factor: 'CROWD', pairId: 'C1', level: 'CROWD_HIGH', readFormat: 1,
        title: 'The school-meals contractor',
        text: 'A photograph circulates showing the school-meals contractor at a private dinner with the procurement officer who approved her renewal. It is a photograph of a dinner. Nothing else has surfaced. Forty thousand shares by lunchtime, and the reply column is a wall of fury.',
        readPrompt: 'Mark your internal confidence for the file. Nobody outside this room sees it.',
        latents: { implication: -0.45, strength: 0.4, reliability: 0.55, diagnosticity: 0.5, deniability: 0.25,
            targetSide: 'NON_PARTISAN', sourceAlignment: 'NEUTRAL',
            crowd: { direction: -1, magnitude: 0.85, independence: 0.25 }, mediaReach: 0.95, salience: 0.3 },
        salience: 0.9,
        choices: [
            { id: 'ride', label: 'Amplify. The anger is already there and it is pointed the right way.', features: F({ exploitation: 0.85, electoralGain: 0.7, horizon: -0.4 }), effect: { capital: 1, funds: 1 } },
            { id: 'process', check: { ability: 'COMM', dc: 54 }, label: 'Ask the council to review the contract properly, and say the photo is not evidence.', features: F({ proceduralRestraint: 0.8, transparency: 0.6, electoralGain: -0.4 }), effect: { capital: 1, standing: -1 }, institutional: true },
            { id: 'silent', label: 'Say nothing. It will burn out.', features: F({ deflection: 0.75 }), effect: {} },
        ],
    },
    {
        id: 'CULVERT_RESULT', age: 33, kind: 'consequence', chapter: 'Council',
        title: 'Second storm',
        resolve: (st) => st.flags.CULVERT_FUNDED
            ? { text: 'The culvert holds. Four streets that flooded in your first year stay dry, and the local paper runs a photograph of the outflow that nobody outside the ward will ever care about. You care about it.', event: { implication: 0.55, strength: 0.7, reliability: 0.9, diagnosticity: 0.7, deniability: 0, trait: 'competence', targetSide: 'PLAYER_SIDE', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.55 } }
            : st.flags.CULVERT_PARTIAL
                ? { text: 'The repaired hundred metres holds. The rest does not. Two streets flood, and because you said plainly what you were doing, nobody accuses you of lying about it.', event: { implication: 0.1, strength: 0.5, reliability: 0.85, diagnosticity: 0.5, deniability: 0, trait: 'competence', targetSide: 'PLAYER_SIDE', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.6 } }
                : { text: 'The study is eleven months from publication. The culvert is not. Six streets flood, and a resident reads your announcement aloud to a television camera standing in her kitchen.', event: { implication: -0.6, strength: 0.9, reliability: 0.92, diagnosticity: 0.65, deniability: 0, trait: 'competence', targetSide: 'PLAYER_SIDE', sourceAlignment: 'NEUTRAL', crowd: { direction: -1, magnitude: 0.5, independence: 0.3 }, mediaReach: 0.8 } },
    },
    // ── CHAIN B seed: accepted \u2192 later DISPROVEN ──
    {
        id: 'SMEAR_RIVAL', age: 33, kind: 'judgment', chapter: 'Council', chainSeed: 'SMEAR', readFormat: 0,
        title: 'The qualifications dossier',
        text: `Ilse Brandt runs it first, under her own byline, and the others follow within the hour. A dossier reaches three newsrooms and your office on the same morning. It says the ${exports.BLOCS[(0, exports.OPP)(P.bloc)].name} candidate for mayor never completed the degree she has claimed for twenty years. It contains registry printouts, a letter on university paper and a statutory declaration. On its face it looks extremely solid.`,
        readPrompt: 'Your chief of staff shuts the door. \u201cOff the record. What do you actually think happened?\u201d',
        latents: { implication: -0.7, strength: 0.75, reliability: 0.72, diagnosticity: 0.7, deniability: 0.2,
            targetSide: 'OPPOSING_SIDE', sourceAlignment: 'ALIGNED', crowd: null, mediaReach: 0.8, salience: 0.2 },
        salience: 0.7,
        choices: [
            { id: 'run', label: 'Put it out. Documents are documents.', features: F({ exploitation: 0.9, electoralGain: 0.8, horizon: -0.5 }), effect: { capital: 1, funds: 2 }, flag: 'RAN_SMEAR', hitsRival: 0.6 },
            { id: 'verify', label: 'Have the registry contacted directly before anyone says a word.', features: F({ proceduralRestraint: 0.9, transparency: 0.5, electoralGain: -0.4, horizon: 0.6 }), effect: { funds: -1 }, institutional: true },
            { id: 'pass', label: 'Refuse it. A degree from 1998 is not why anyone should lose.', features: F({ proceduralRestraint: 0.5, personalCost: 0.4, electoralGain: -0.5 }), effect: { capital: 1 } },
        ],
    },
    // ── MATCHED PAIR B, member 2: same evidence, no crowd ──
    {
        id: 'CROWD_QUIET', age: 34, kind: 'judgment', chapter: 'Council',
        factor: 'CROWD', pairId: 'C1', level: 'CROWD_LOW', readFormat: 1,
        title: 'The transport consultancy',
        text: 'A photograph reaches your office showing the transport consultancy\'s director at a private dinner with the officer who renewed her framework agreement. It is a photograph of a dinner. Nothing else has surfaced. It has been sitting in a local reporter\'s drafts folder for a week and nobody has picked it up.',
        readPrompt: 'Mark your internal confidence for the file. Nobody outside this room sees it.',
        latents: { implication: -0.45, strength: 0.4, reliability: 0.55, diagnosticity: 0.5, deniability: 0.25,
            targetSide: 'NON_PARTISAN', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.35 },
        choices: [
            { id: 'push', label: 'Push it to the press yourself.', features: F({ exploitation: 0.8, electoralGain: 0.5 }), effect: {} },
            { id: 'process', label: 'Ask for a proper review of the framework agreement.', features: F({ proceduralRestraint: 0.8, transparency: 0.55 }), effect: { capital: 1 }, institutional: true },
            { id: 'silent', label: 'Nothing here worth acting on.', features: F({ deflection: 0.6 }), effect: {} },
        ],
    },
    { id: 'CHAIN_HOUSING', age: 35, kind: 'chain', chapter: 'Rising', chain: 'HOUSING' },
    // ── MATCHED PAIR C, member 1: high deniability ──
    {
        id: 'RECORDING_DENIABLE', age: 35, kind: 'judgment', chapter: 'Rising',
        factor: 'DENIABILITY', pairId: 'D1', level: 'DEN_HIGH', readFormat: 0,
        title: 'Forty-one seconds',
        text: 'A forty-one second recording surfaces of the regional housing chair apparently agreeing to move a rezoning decision in exchange for a favour. The chair says the audio is synthetic and has hired a firm that says so too. A different firm says it cannot tell. Nobody can produce the original file.',
        readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
        latents: { implication: -0.75, strength: 0.7, reliability: 0.6, diagnosticity: 0.8, deniability: 0.8,
            targetSide: 'NON_PARTISAN', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.85 },
        choices: [
            { id: 'treat', label: 'Treat it as real until someone proves otherwise.', features: F({ exploitation: 0.6, electoralGain: 0.4 }), effect: {} },
            { id: 'forensic', cost: { funds: 4 }, lockNote: 'Your campaign cannot currently fund an external review.', label: 'Fund an independent forensic examination before anyone says anything.', features: F({ proceduralRestraint: 0.85, transparency: 0.6, horizon: 0.5 }), effect: { funds: -1, capital: 1 }, institutional: true },
            { id: 'dismiss', label: 'Say publicly that unverifiable audio should not end careers.', features: F({ proceduralRestraint: 0.4, deflection: 0.4 }), effect: {} },
        ],
    },
    // The player has been judging other people for ten years. Now it is their turn.
    // This is also the only event that gives the four cognitive mechanisms real work
    // to do on the player's own reputation.
    {
        id: 'THE_ALLEGATION', age: 36, pressure: 8, kind: 'story', chapter: 'Rising', responsibility: true,
        title: 'Your turn',
        text: 'A ' + exports.BLOCS[(0, exports.OPP)(P.bloc)].name + '-aligned outlet reports that your first campaign accepted eleven thousand from a construction firm that won a resurfacing contract fourteen months later. Both facts are true. The connection between them is asserted, not shown. By evening it is the only thing anyone wants to ask you about.',
        salience: 1.0,
        abilityOption: 'COMM',
        playerAllegation: { implication: -0.72, strength: 0.55, reliability: 0.62, diagnosticity: 0.75,
            deniability: 0.4, trait: 'integrity', targetSide: 'PLAYER_SIDE', sourceAlignment: 'OPPOSED',
            crowd: { direction: -1, magnitude: 0.8, independence: 0.25 }, mediaReach: 0.95, salience: 0.5 },
        choices: [
            { id: 'open_meeting', requires: { COMM: 55 }, check: { ability: 'COMM', dc: 60 },
                label: 'Book the biggest hall in the ward, invite the reporter, and take questions until they stop.',
                features: F({ transparency: 0.9, concession: 0.2, personalCost: 0.7, electoralGain: -0.1 }),
                effect: { capital: 2 } },
            { id: 'disclose', label: 'Publish every donation and every contract from that year. All of it.',
                features: F({ transparency: 0.95, concession: 0.4, personalCost: 0.6, electoralGain: -0.2, horizon: 0.7 }), effect: { capital: 2, standing: -2 } },
            { id: 'ethics', label: 'Refer yourself to the ethics committee and stop commenting.',
                features: F({ proceduralRestraint: 0.9, transparency: 0.4, personalCost: 0.4, electoralGain: -0.35 }), effect: { capital: 1, standing: -1 }, institutional: true },
            { id: 'deny', label: 'Attack the outlet. It is a smear and its owner is on the other side.',
                features: F({ selfProtection: 0.9, deflection: 0.6, exploitation: 0.4, electoralGain: 0.3 }), effect: { standing: 2, funds: 1 } },
            { id: 'settle', label: 'Return the money quietly and say nothing.',
                features: F({ deflection: 0.7, concession: 0.3, selfProtection: 0.4 }), effect: { funds: -2 } },
        ],
    },
    // ── MATCHED PAIR A, member 2: own-side target, same latents as OPP_CONTRACT ──
    {
        id: 'ALLY_CONTRACT', age: 36, kind: 'judgment', chapter: 'Rising', responsibility: false,
        factor: 'PARTISAN', pairId: 'P1', level: 'PLAYER_SIDE', readFormat: 0,
        title: 'A contract on your side',
        text: `A ${exports.BLOCS[P.bloc].name} councillor you have worked beside for six years has a brother-in-law who won the waste-collection contract for the western districts. The procurement file shows two bidders and one very short evaluation window. She tells you, personally, that the process was clean and the family connection is a coincidence.`,
        readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
        latents: { implication: -0.62, strength: 0.62, reliability: 0.68, diagnosticity: 0.75, deniability: 0.2,
            targetSide: 'PLAYER_SIDE', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.7 },
        choices: [
            { id: 'demand', check: { ability: 'COMM', dc: 58 }, label: 'Say publicly that she should stand down while it is investigated.', features: F({ concession: 0.7, transparency: 0.7, electoralGain: -0.5, personalCost: 0.6 }), effect: { standing: -3, capital: 1 } },
            { id: 'refer', cost: { capital: 2 }, lockNote: 'You have no standing left to spend on asking the Audit Office for favours.', label: 'Refer the file to the Audit Office and say nothing else.', features: F({ proceduralRestraint: 0.85, transparency: 0.5, horizon: 0.4 }), effect: { standing: -1 }, institutional: true },
            { id: 'shield', label: 'Back her publicly. You have seen the woman work.', features: F({ selfProtection: 0.6, deflection: 0.6, electoralGain: 0.2 }), effect: { standing: 3, funds: 1 } },
        ],
    },
    { id: 'CHAIN_SMEAR', age: 37, kind: 'chain', chapter: 'Rising', chain: 'SMEAR' },
    {
        id: 'PARTY_OFFER', age: 33, kind: 'story', chapter: 'The offer', measurement: 'NONE',
        title: 'The call from the capital',
        text: 'The deputy leader wants you in the capital as a policy spokesperson. It is a real job with a real staff and it is two hundred miles from the only place that has ever voted for you. She does not say what she wants in return, because people at her level do not have to.',
        prompt: 'You have until Friday.',
        choices: [
            { id: 'accept', label: 'Accept. The capital is where things are decided.',
                features: F({ electoralGain: 0.5, horizon: 0.3 }),
                effect: { standing: 5, funds: 4, capital: 1 }, flag: 'CAPITAL_ROLE',
                career: { independence: -0.4, recognition: +0.18, local: -0.15 } },
            { id: 'accept_with_people', requires: { NEG: 55 }, check: { ability: 'NEG', dc: 54 },
                label: 'Accept — and bring two of your own people into the office with you.',
                features: F({ proceduralRestraint: 0.3, electoralGain: 0.55, horizon: 0.7 }),
                effect: { standing: 4, funds: 3, capital: 2 }, flag: 'CAPITAL_ROLE',
                career: { independence: -0.15, recognition: +0.16 } },
            { id: 'conditional', label: 'Accept, on the condition that you keep the ward and your own line on housing.',
                features: F({ proceduralRestraint: 0.4, transparency: 0.35, horizon: 0.5 }),
                effect: { standing: 2, funds: 2 }, flag: 'CAPITAL_CONDITIONAL',
                career: { independence: -0.1, recognition: +0.10 } },
            { id: 'decline', label: 'Decline. Build something here that is yours.',
                features: F({ horizon: 0.7, selfProtection: 0.2 }),
                effect: { capital: 3 }, flag: 'STAYED_LOCAL',
                career: { independence: +0.25, recognition: -0.04, local: +0.15 } },
            { id: 'refuse_loudly', label: 'Decline, and say publicly that the capital has stopped listening to wards like yours.',
                features: F({ exploitation: 0.45, transparency: 0.5, institutionalCost: 0.25 }),
                effect: { capital: 2, standing: -3 }, flag: 'BURNED_BRIDGE',
                career: { independence: +0.45, recognition: +0.22, local: +0.2 } },
        ],
    },
    {
        id: 'AUDIT_OFFICE', age: 37, kind: 'story', when: (st) => !!st.office, chapter: 'Rising', institutional: true, responsibility: true,
        title: 'The Audit Office asks for more',
        text: 'The Audit Office wants standing access to departmental procurement records without prior notice. It would make your own next four years considerably less comfortable, and it would survive you by decades. The vote is close and your bloc is looking at you.',
        choices: [
            { id: 'grant', check: { ability: 'NEG', dc: 56 }, label: 'Support it in full.', features: F({ proceduralRestraint: 0.95, transparency: 0.85, horizon: 0.9, personalCost: 0.7, electoralGain: -0.3 }), effect: { standing: -3, capital: 2 } },
            { id: 'narrow', label: 'Support it, with a notice period.', features: F({ proceduralRestraint: 0.5, transparency: 0.4, institutionalCost: 0.35, horizon: 0.3 }), effect: { capital: 1 } },
            { id: 'narrow_amendment', requires: { POLICY: 58 }, check: { ability: 'POLICY', dc: 55 },
                label: 'Draft an amendment: full access, but a standing carve-out for live investigations — and get it through.',
                features: F({ proceduralRestraint: 0.75, transparency: 0.6, institutionalCost: 0.15, horizon: 0.75, personalCost: 0.3 }),
                effect: { capital: 3 } },
            { id: 'block', label: 'Block it. The office already has enough.', features: F({ selfProtection: 0.8, institutionalCost: 0.85, electoralGain: 0.4, horizon: -0.5 }), effect: { standing: 3, funds: 2 } },
        ],
    },
    // ── MATCHED PAIR C, member 2: same evidence, low deniability ──
    {
        id: 'RECORDING_CLEAN', age: 38, kind: 'judgment', chapter: 'Rising',
        factor: 'DENIABILITY', pairId: 'D1', level: 'DEN_LOW', readFormat: 0,
        title: 'Forty-four seconds',
        text: 'A forty-four second recording surfaces of the regional licensing chair apparently agreeing to move a permit decision in exchange for a favour. The original file was handed over by the person who made it, with the device, and two independent laboratories have examined it and found no sign of editing.',
        readPrompt: 'Your chief of staff shuts the door. "Off the record. What do you actually think happened?"',
        latents: { implication: -0.75, strength: 0.7, reliability: 0.6, diagnosticity: 0.8, deniability: 0.05,
            targetSide: 'NON_PARTISAN', sourceAlignment: 'NEUTRAL', crowd: null, mediaReach: 0.85 },
        choices: [
            { id: 'treat', label: 'Say publicly that it is authentic and should be acted on.', features: F({ transparency: 0.6, electoralGain: 0.3 }), effect: {} },
            { id: 'forensic', label: 'Wait for the licensing committee to complete its own process.', features: F({ proceduralRestraint: 0.8, horizon: 0.4 }), effect: { capital: 1 }, institutional: true },
            { id: 'dismiss', label: 'Note that recordings can mislead even when they are real.', features: F({ deflection: 0.6 }), effect: {} },
        ],
    },
    { id: 'CHAIN_GRANT', age: 39, kind: 'chain', chapter: 'The run', chain: 'GRANT' },
    {
        id: 'THE_TIP', age: 39, tradeoff: true, kind: 'story', chapter: 'The run', temptation: true,
        title: 'Eleven days out',
        text: 'Eleven days before the vote, a folder reaches your campaign. It suggests your opponent\'s foundation moved money it should not have moved. It is unverified. Verifying it properly would take three weeks you do not have. Using it would probably decide the election.',
        choices: [
            { id: 'verify', cost: { funds: 3 }, lockNote: 'Verification costs money you do not have eleven days out.', label: 'Try to verify it. Say nothing until you can.', features: F({ proceduralRestraint: 0.9, transparency: 0.5, electoralGain: -0.7, horizon: 0.7 }), effect: { funds: -2 }, flag: 'TIP_VERIFY', stakes: { core: -0.15, ind: 0.2 } },
            { id: 'read_it', requires: { STRAT: 58 }, label: 'Before deciding anything: have your analyst take the folder apart overnight.',
                features: F({ proceduralRestraint: 0.65, horizon: 0.5 }), effect: {}, flag: 'TIP_ANALYSED',
                strategyRead: true },
            { id: 'hint', label: 'Say there are "serious questions" without making the claim.', features: F({ exploitation: 0.6, deflection: 0.5, electoralGain: 0.6 }), effect: {}, flag: 'TIP_HINT', hitsRival: 0.35, stakes: { core: 0.18, ind: -0.12 } },
            { id: 'attack', label: 'Use it. Attribute it. Let them deny it.', features: F({ exploitation: 0.95, electoralGain: 0.85, horizon: -0.6 }), effect: { capital: 1 }, flag: 'TIP_ATTACK', hitsRival: 0.75, stakes: { core: 0.3, ind: -0.25, opp: -0.2 } },
            { id: 'refuse', label: 'Destroy the folder and tell the campaign it never arrived.', features: F({ proceduralRestraint: 0.8, personalCost: 0.5, electoralGain: -0.6, horizon: 0.6 }), effect: { capital: 1 }, flag: 'TIP_REFUSE' },
        ],
    },
    { id: 'TIP_FALLOUT', age: 40, kind: 'fallout', chapter: 'The run',
        when: (st) => !!(st.flags.TIP_ATTACK || st.flags.TIP_HINT) },
    { id: 'ELECTION_2', age: 40, kind: 'election', chapter: 'The run', office: 'City Mayor', tier: 2 },
];
// Beats are authored in thematic groups but must play in chronological order.
// Stable sort keeps the authored sequence within a single year.
// ── v0.37: formative years ────────────────────────────────────────────────
// The life now starts at 23, before anyone would call this person a politician.
// Three short beats, then the existing career. The point is that the player should
// remember becoming one rather than arriving as one.
const EARLY_SCRIPT = (P) => [
    {
        id: 'ENTRY_23', age: 23, kind: 'story', chapter: 'Before',
        title: 'The first office',
        text: exports.ROUTE_ENTRY[P.route] || exports.ROUTE_ENTRY.CIVIC,
        prompt: 'Two months in, you notice something.',
        choices: [
            { id: 'raise', label: 'Say it out loud in the Monday meeting.',
                features: F({ transparency: 0.8, personalCost: 0.4, proceduralRestraint: 0.3 }),
                effect: { capital: 2 }, check: { ability: 'COMM', dc: 40 }, xp: ['COMM'] },
            { id: 'memo', label: 'Put it in writing to one person who can act on it.',
                features: F({ proceduralRestraint: 0.7, transparency: 0.4, horizon: 0.4 }),
                effect: { capital: 1, standing: 1 }, check: { ability: 'POLICY', dc: 40 }, xp: ['POLICY'] },
            { id: 'useful', label: 'Say nothing, and make yourself useful to the person it protects.',
                features: F({ selfProtection: 0.6, electoralGain: 0.4, deflection: 0.4 }),
                effect: { standing: 3, funds: 1 }, xp: ['NEG'] },
        ],
    },
    {
        id: 'FORMATIVE_24', age: 24, kind: 'story', chapter: 'Before',
        title: 'The night they lose',
        text: 'Your side loses the regional election by nine hundred votes. At two in the morning the room is looking for someone to blame, and the campaign manager is drunk and specific about it. Somebody has to talk to the volunteers who gave up four months of their lives.',
        prompt: 'You are the most junior person still standing.',
        choices: [
            { id: 'speak', label: 'Get up on a chair and thank them by name until you run out of names.',
                features: F({ transparency: 0.6, horizon: 0.5 }), effect: { capital: 2 },
                check: { ability: 'COMM', dc: 42 }, xp: ['COMM', 'ORG'] },
            { id: 'numbers', label: 'Go and find out where the nine hundred votes actually went.',
                features: F({ proceduralRestraint: 0.4, horizon: 0.7 }), effect: { capital: 1 },
                check: { ability: 'STRAT', dc: 42 }, xp: ['STRAT', 'STRAT'] },
            { id: 'list', label: 'Take the volunteer list home. These are the only people who will ever knock for you.',
                features: F({ electoralGain: 0.5, horizon: 0.6 }), effect: { standing: 1, funds: 1 },
                xp: ['ORG', 'ORG'] },
        ],
    },
    {
        id: 'FORMATIVE_FOCUS', age: 25, kind: 'milestone', chapter: 'Before',
        grant: 'FORMATIVE',
        text: 'You are twenty-five and nobody is going to hand you anything. Whatever you spend the next two years getting good at is the thing you will be, when it eventually matters.',
    },
];
exports.EARLY_SCRIPT = EARLY_SCRIPT;
exports.ROUTE_ENTRY = {
    STAFF: 'You are twenty-three and you answer a member\'s correspondence for a salary that does not cover the room you rent. You have read every bill that passed this session because nobody else in the office has time to.',
    CIVIC: 'You are twenty-three and you run a tenants\' association out of a room above a laundrette. Forty households, one damp problem the council will not name, and a phone that rings at eleven at night.',
    PROF: 'You are twenty-three and you check municipal procurement files for a living. It is the least glamorous job in the building and it is the only one where you get to read everything.',
};
const SCRIPT = (P) => [...(0, exports.EARLY_SCRIPT)(P), ...RAW_SCRIPT(P)]
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (x.b.age - y.b.age) || (x.i - y.i))
    .map((x) => x.b);
exports.SCRIPT = SCRIPT;

}],
"src/playtest.mjs": [{}, function(module, exports, require) {
"use strict";
// Political Mirror — human playtest scaffolding.
// Additive only. Nothing here changes game balance or the simulation.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ABILITY_SURVEY_IDS = exports.SURVEY = exports.SHUFFLED_RESOLUTION = exports.SHUFFLED_PROFILE = exports.BUILD_LABEL = exports.SHUFFLE_RATE = exports.PLAYTEST_SEEDS = void 0;
exports.resolveTestMode = resolveTestMode;
exports.resolveMirrorOverride = resolveMirrorOverride;
exports.assignMirrorArm = assignMirrorArm;
exports.randomSessionId = randomSessionId;
exports.newSession = newSession;
exports.logDecision = logDecision;
exports.logRead = logRead;
exports.logLocked = logLocked;
exports.logDevelopment = logDevelopment;
exports.logExecution = logExecution;
exports.logAbilityOption = logAbilityOption;
exports.recordAbilityStart = recordAbilityStart;
exports.recordAbilityFinal = recordAbilityFinal;
exports.snapshotMirror = snapshotMirror;
exports.markGameplayEnd = markGameplayEnd;
exports.markSurveyStart = markSurveyStart;
exports.finishSession = finishSession;
exports.exportFilename = exportFilename;
// ── Tester seeds, found by searching 900 worlds at the shipped electorate size of 700
// agents (tools/seedhunt2.mjs). A seed's behaviour depends on agent count, so these are
// only valid for the 700-agent build. ──
exports.PLAYTEST_SEEDS = {
    natural: { seed: null, label: 'Natural seed',
        note: 'A random world. What an ordinary player gets.' },
    defeat: { seed: 'POL-003K', label: 'Forced early defeat',
        note: 'Most scripted styles lose the first election here, and every one of those runs finds a way back. Re-hunted for v0.37: the formative years leave players stronger, so no seed defeats every style any more.' },
    close: { seed: 'POL-001J', label: 'Competitive',
        note: 'Across the shipped backgrounds and styles, only one run loses the first election; mayoral results span 15.7 points and one lands at 49.72%. Choices decide it.' },
    strong: { seed: 'POL-001Q', label: 'Strong opponent',
        note: 'A true STRONG-rival world. Twelve of eighteen runs lose first, four still win the mayoralty, and four of the twelve defeated runs find a comeback.' },
};
function resolveTestMode(raw) {
    const k = String(raw || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(exports.PLAYTEST_SEEDS, k) ? k : null;
}
// ── Barnum arm assignment ────────────────────────────────────────────────────
// Assigned from the session, never from the world seed. Deriving it from the seed meant
// the three fixed tester seeds all resolved to TRUE and natural mode was hard-coded TRUE,
// so a whole 6-10 person round could not contain a single shuffled Mirror.
// Two testers on the same seed must be able to land in different arms.
exports.SHUFFLE_RATE = 0.25;
// Recorded in every export so v0.3 baseline sessions and v0.36 ability sessions can be
// told apart during the A/B comparison. Normal players never see it.
exports.BUILD_LABEL = 'v0.37.2-single-session';
function resolveMirrorOverride(raw) {
    const k = String(raw || '').toLowerCase();
    if (k === 'true' || k === 'real')
        return 'TRUE';
    if (k === 'shuffled' || k === 'shuffle' || k === 'false')
        return 'SHUFFLED';
    return null;
}
function assignMirrorArm({ sessionId, override } = {}) {
    const forced = resolveMirrorOverride(override);
    if (forced)
        return forced;
    // Hash the session id, which is random per session and independent of the world.
    let h = 2166136261 >>> 0;
    const s = String(sessionId || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return (h % 1000) / 1000 < exports.SHUFFLE_RATE ? 'SHUFFLED' : 'TRUE';
}
function randomSessionId(rand = Math.random) {
    let s = '';
    for (let i = 0; i < 6; i++)
        s += '0123456789ABCDEF'[Math.floor(rand() * 16)];
    return 'PM_TEST_' + s;
}
// ── Session log ──
// Local only. Never transmitted. Contains no identity of any kind.
function newSession({ sessionId, seed, testMode, mirrorMode, startedAt }) {
    return {
        schema: 'political-mirror-playtest/1',
        build: exports.BUILD_LABEL,
        sessionId,
        seed,
        testMode: testMode || 'natural',
        mirrorMode: mirrorMode || 'TRUE', // TRUE | SHUFFLED (Barnum control)
        startedAt, // session boot
        gameplayEndedAt: null, // the moment the Mini Mirror is first reached
        gameplayMs: null, // career length — the number the guide judges game length by
        surveyStartedAt: null, // first survey answer, or null if never started
        surveyEndedAt: null,
        surveyMs: null,
        endedAt: null,
        totalSessionMs: null,
        playtimeMs: null, // DEPRECATED alias of totalSessionMs; kept for schema/1 readers
        character: null,
        decisions: [], // { beatId, kind, age, choiceId, label, msToDecide }
        reads: [], // { beatId, age, credence, msToDecide }
        elections: [], // { age, office, won, share, turnout, approval }
        wildernessRoute: null,
        chainsSeen: [], // { chain, file, outcome, tone, credenceAtSeed }
        lockedOptionsSeen: [], // { beatId, choiceId, reason }
        counterfactualOpened: false,
        // ── ability system (v0.36) ──
        background: null, // STAFF | CIVIC | PROF
        abilityStart: null, // visible starting profile
        abilityAptitude: null, // HIDDEN natural ranges — developer analysis only, never rendered
        abilityBands: null, // which ability drew signature / strong / ordinary / narrow
        abilityFinal: null,
        abilityXP: null, // use-based experience accumulated
        developments: [], // { reason, budget, primary, secondary, before, after, gained }
        abilityOptionsSeen: [], // { beatId, choiceId, requires, met }  — aspiration vs frustration
        executionChecks: [], // { beatId, choiceId, ability, value, grade }
        strategyInfoUnlocked: false,
        mirrorReached: false,
        mirror: null, // { resolution, components, dimensions:[{key,label,n,value,conf}] }
        survey: null,
    };
}
function logDecision(s, d) { s.decisions.push(d); return s; }
function logRead(s, r) { s.reads.push(r); return s; }
function logLocked(s, l) {
    if (!s.lockedOptionsSeen.some((x) => x.beatId === l.beatId && x.choiceId === l.choiceId))
        s.lockedOptionsSeen.push(l);
    return s;
}
function logDevelopment(s, d) { if (s)
    s.developments.push(d); return s; }
function logExecution(s, e) { if (s)
    s.executionChecks.push(e); return s; }
function logAbilityOption(s, o) {
    if (!s)
        return s;
    if (!s.abilityOptionsSeen.some((x) => x.beatId === o.beatId && x.choiceId === o.choiceId))
        s.abilityOptionsSeen.push(o);
    return s;
}
// Captured at character creation. The aptitude block is the one thing in this file the
// player must never see; it exists so we can ask afterwards whether a tester's sense of
// "this comes naturally" matched what the engine actually rolled.
function recordAbilityStart(s, background, ab) {
    if (!s)
        return s;
    s.background = background;
    s.abilityStart = { ...ab.value };
    s.abilityAptitude = { ...ab.aptitude };
    s.abilityBands = { ...ab.bands };
    return s;
}
function recordAbilityFinal(s, ab) {
    if (!s)
        return s;
    s.abilityFinal = { ...ab.value };
    s.abilityXP = { ...ab.xp };
    return s;
}
function snapshotMirror(analysis, res) {
    const dims = [];
    for (const [key, d] of Object.entries(analysis.voter))
        dims.push({ side: 'voter', key, label: d.label, n: d.n, value: d.value, conf: d.conf });
    for (const [key, d] of Object.entries(analysis.political))
        dims.push({ side: 'political', key, label: d.label, n: d.n, value: d.value, conf: d.conf });
    return { resolution: res.resolution, components: res.components, missing: res.missing, dimensions: dims };
}
// Gameplay ends when the career does — the moment the Mirror is reached. Everything
// after that is reading the result and answering questions, which must not be counted
// as evidence that the game itself runs long.
function markGameplayEnd(s, at) {
    if (!s || s.gameplayEndedAt !== null)
        return s;
    s.gameplayEndedAt = at;
    s.gameplayMs = at - s.startedAt;
    return s;
}
function markSurveyStart(s, at) {
    if (!s || s.surveyStartedAt !== null)
        return s;
    s.surveyStartedAt = at;
    return s;
}
function finishSession(s, endedAt) {
    s.endedAt = endedAt;
    if (s.gameplayEndedAt === null)
        markGameplayEnd(s, endedAt);
    s.surveyEndedAt = s.surveyStartedAt === null ? null : endedAt;
    s.surveyMs = s.surveyStartedAt === null ? null : endedAt - s.surveyStartedAt;
    s.totalSessionMs = endedAt - s.startedAt;
    s.playtimeMs = s.totalSessionMs; // deprecated alias
    return s;
}
// ── Barnum control ──
// A plausible Mirror from a different, fixed run. Presentation must be identical to a
// real one; only this flag distinguishes them, and only in the log. This is a sanity
// check, not an experiment: if a shuffled Mirror reads as accurately as a real one,
// the Mirror is too generic to be saying anything about the player.
exports.SHUFFLED_PROFILE = {
    voter: {
        evidenceSensitivity: { label: 'Evidence Sensitivity', n: 8, value: 0.52, conf: 0.61,
            detail: 'slope 0.52 across 8 judgments', cases: [] },
        partisanSymmetry: { label: 'Partisan Symmetry', n: 1, value: 0.25, conf: 0.38, cases: [] },
        crowdSusceptibility: { label: 'Crowd Susceptibility', n: 1, value: 0.20, conf: 0.38, cases: [] },
        deniabilitySusceptibility: { label: 'Deniability Susceptibility', n: 1, value: -0.20, conf: 0.38, cases: [] },
    },
    political: {
        accountability: { label: 'Accountability', n: 2, value: 0.35, conf: 0.40 },
        institutionalRestraint: { label: 'Institutional Restraint', n: 3, value: 0.45, conf: 0.51 },
        powerOrientation: { label: 'Power / Survival Orientation', n: 9, value: 0.28, conf: 0.85 },
    },
    nReads: 8, nMoves: 9,
};
exports.SHUFFLED_RESOLUTION = {
    resolution: 0.64,
    components: { volume: 0.57, coverage: 0.67, replication: 0.5, consistency: 0.52 },
    missing: ['deniable'],
};
// ── Post-game survey ──
exports.SURVEY = [
    { id: 'q1', type: 'scale7', q: 'How much did you want to keep playing until the end?',
        lo: 'Wanted to stop', hi: 'Wanted to keep going' },
    { id: 'q2', type: 'text', q: 'At what point, if any, did the game start to feel repetitive?' },
    { id: 'q3', type: 'text', q: 'Which decision was hardest to make?' },
    { id: 'q4', type: 'yesno_text', q: 'Did any choice feel like it had an obvious "correct answer"?',
        followUp: 'Which one?' },
    { id: 'q5', type: 'choice', q: 'When an old case returned years later, did you remember the original event?',
        options: ['Yes, clearly', 'Vaguely', 'No'] },
    { id: 'q6', type: 'choice', q: 'If you lost an election: did losing make you want to continue?',
        options: ['More', 'Same', 'Less', 'Not applicable'] },
    { id: 'q7', type: 'choice', q: 'How did the locked resource options feel?',
        options: ['A meaningful constraint', 'Frustrating', 'Confusing', 'Barely noticed them'] },
    { id: 'q8', type: 'scale7', q: 'Did the Mini Mirror feel specific to your choices?',
        lo: 'Could be anyone', hi: 'Specifically me' },
    { id: 'q9', type: 'text', q: 'Did anything in the Mirror surprise you?' },
    { id: 'q10', type: 'scale7_na', q: 'Did the Counterfactual Audit help you understand why voters reacted differently?',
        lo: 'Not at all', hi: 'A lot', na: 'I did not open it' },
    { id: 'q11', type: 'scale7', q: 'After playing, how interested are you in living another political life?',
        lo: 'Not at all', hi: 'Very' },
    { id: 'q12', type: 'text', q: 'What single thing would make you want to play again?' },
    // ── ability section (v0.36 build only) ──
    { id: 'q13', type: 'scale7', section: 'ability',
        q: 'Did developing your politician make the game feel more like a political life?',
        lo: 'Not at all', hi: 'Very much' },
    { id: 'q14', type: 'choice', section: 'ability',
        q: 'Did the development choices feel like career decisions, or like a stat menu?',
        options: ['Strongly like career decisions', 'Somewhat like career decisions', 'Mixed',
            'Somewhat like stat allocation', 'Strongly like stat allocation'] },
    { id: 'q15', type: 'multitext', section: 'ability',
        q: 'Without looking back: what do you think each of these actually does?',
        fields: ['Public Communication', 'Policy & Governance', 'Organization', 'Negotiation', 'Political Strategy'] },
    { id: 'q16', type: 'choice', section: 'ability', q: 'Which ability felt most useful in your run?',
        options: ['Public Communication', 'Policy & Governance', 'Organization', 'Negotiation', 'Political Strategy', 'None stood out'] },
    { id: 'q17', type: 'choice', section: 'ability', q: 'Which ability felt least noticeable?',
        options: ['Public Communication', 'Policy & Governance', 'Organization', 'Negotiation', 'Political Strategy', 'They all registered'] },
    { id: 'q18', type: 'scale7', section: 'ability',
        q: 'Did you understand why some development choices produced more growth than others?',
        lo: 'No idea', hi: 'Completely clear' },
    { id: 'q19', type: 'choice', section: 'ability',
        q: 'Some things came more naturally to your politician than others. That felt:',
        options: ['Interesting', 'Confusing', 'Unfair', 'Barely noticed it', 'Not sure'] },
    { id: 'q20', type: 'yesno_text', section: 'ability',
        q: 'Did any option you could not take make you think "I wish I had developed differently"?',
        followUp: 'Which moment?' },
    { id: 'q21', type: 'scale7_text', section: 'ability',
        q: 'Did the development screen ever interrupt the feeling of living a political life?',
        lo: 'Never', hi: 'Constantly', followUp: 'Anything you want to add?' },
    { id: 'q22', type: 'scale7', section: 'ability',
        q: 'If you played again, would you deliberately build a different kind of politician?',
        lo: 'Same again', hi: 'Definitely different' },
];
exports.ABILITY_SURVEY_IDS = exports.SURVEY.filter((q) => q.section === 'ability').map((q) => q.id);
function exportFilename(sessionId) { return sessionId + '.json'; }

}],
"pilot/prediction.mjs": [{"../src/engine.mjs":"src/engine.mjs","./cases.mjs":"pilot/cases.mjs","./actor-context.mjs":"pilot/actor-context.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTOR_RULE = exports.ACTOR_RULE_VERSION = exports.MODEL_SPEC = exports.MODEL_IDS = exports.MODEL_VERSION = void 0;
exports.buildPredictionCommit = buildPredictionCommit;
// Prespecified transfer models. This module never accepts T1/T2 observed judgments.
const engine_mjs_1 = require("../src/engine.mjs");
const cases_mjs_1 = require("./cases.mjs");
const actor_context_mjs_1 = require("./actor-context.mjs");
exports.MODEL_VERSION = 'pm-fixed-transfer/2.0.0';
exports.MODEL_IDS = Object.freeze(['M0', 'M1', 'M2', 'M3']);
exports.MODEL_SPEC = Object.freeze({
    evidenceReference: 0.45,
    interceptPseudoCount: 4,
    evidencePseudoCount: 4,
    pairPseudoCount: 2,
    credenceAnchors: Object.freeze([0.15, 0.40, 0.60, 0.85]),
    output: 'probability judgment on 0–100 scale; not probability of a future binary response',
});
// M3 (0.38.1-pilot.1): actor-side public decisions only. Rule `pm-actor-public-judgment/2.0.0`.
// The frozen game contains nine public judgment events with an identical three-option
// structure (act on the allegation / refer to process / dismiss) and three matched pairs whose
// only difference is the same manipulation used by the T1 case bank: target side (P1),
// public anger with identical evidence (C1) and a deniability claim with identical
// evidence (D1). M3 therefore predicts each T1 within-dimension contrast from the
// participant's OWN public-action contrast on the matched public pair, and the evidence
// contrast from the slope of public action on frozen evidence quality across the
// non-partisan, no-crowd, low-deniability events. Cross-role consistency ("acts as they
// judge") is the hypothesis under test; the rival strategic-action account predicts null or
// reversed association. No T0 answer, private read, T1/T2 answer, Mirror output or
// questionnaire can enter: the only input is the projected actor context
// (pilot/actor-context.mjs). Scale and fallback rules are engineering priors documented in
// pilot-docs/M3_SCIENTIFIC_SPEC.md; nothing here was fitted to any data.
exports.ACTOR_RULE_VERSION = 'pm-actor-public-judgment/2.0.0';
exports.ACTOR_RULE = Object.freeze({
    ruleVersion: exports.ACTOR_RULE_VERSION,
    intercept: 0.5,
    pointsPerUnitIndex: 25,
    actionCredence: Object.freeze({ act: 1, process: 0.5, dismiss: 0 }),
    pairs: Object.freeze({
        partisanSymmetry: Object.freeze({ pairId: 'P1', high: 'OPP_CONTRACT', low: 'ALLY_CONTRACT',
            hypothesis: 'public readiness to act against an opposing-side official minus own-side official predicts the T1 opposing-minus-own credence contrast (same sign)' }),
        crowdSusceptibility: Object.freeze({ pairId: 'C1', high: 'CROWD_LOUD', low: 'CROWD_QUIET',
            hypothesis: 'public readiness to act under visible public anger minus without it (identical evidence) predicts the T1 crowd-high minus crowd-low contrast (same sign)' }),
        deniabilitySusceptibility: Object.freeze({ pairId: 'D1', high: 'RECORDING_DENIABLE', low: 'RECORDING_CLEAN',
            hypothesis: 'public readiness to act on a deniable recording minus an authenticated one predicts the T1 deniable-minus-authenticated contrast (same sign; usually negative)' }),
    }),
    evidence: Object.freeze({
        events: Object.freeze(['TIP_HOUSING', 'CROWD_QUIET', 'GRANT_QUESTION', 'RECORDING_CLEAN']),
        minimumEvents: 3,
        t1DesignRange: 0.5,
        hypothesis: 'the least-squares slope of public action credence on frozen evidence quality (non-partisan target, no crowd, low deniability) predicts the T1 strong-minus-weak evidence contrast (same sign)',
    }),
    fallback: 'a dimension whose public pair was not decided, or whose option set was restricted by a locked option in either member, is not personalized: both items receive the intercept and the reason is recorded',
    excluded: Object.freeze(['T0 responses', 'in-game private reads', 'T1 responses', 'T2 responses', 'Mirror output', 'questionnaire', 'elections/office', 'private profiles']),
});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const shrink = (n, k) => n / (n + k);
const clone = (value) => JSON.parse(JSON.stringify(value));
function freezeDeep(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freezeDeep);
        Object.freeze(value);
    }
    return value;
}
const DESIGN_RANGE = Object.freeze({ evidenceSensitivity: 0.5, partisanSymmetry: 1, crowdSusceptibility: 1, deniabilitySusceptibility: 1 });
function actorModel(actorContext) {
    (0, actor_context_mjs_1.validateActorContext)(actorContext);
    const decided = new Map();
    for (const d of actorContext.judgmentDecisions) {
        if (decided.has(d.eventId))
            throw new Error(`Public judgment event ${d.eventId} decided twice`);
        decided.set(d.eventId, d);
    }
    const dimensions = {};
    const dimension = (key, fields) => {
        dimensions[key] = { ...fields, coefficient: fields.available ? exports.ACTOR_RULE.pointsPerUnitIndex / 100 * fields.index / DESIGN_RANGE[key] : 0,
            predictedPairContrastPoints: fields.available ? exports.ACTOR_RULE.pointsPerUnitIndex * fields.index : 0 };
    };
    for (const [key, pair] of Object.entries(exports.ACTOR_RULE.pairs)) {
        const high = decided.get(pair.high), low = decided.get(pair.low);
        const reasons = [];
        if (!high)
            reasons.push(`${pair.high} not decided`);
        if (!low)
            reasons.push(`${pair.low} not decided`);
        if (high && !high.allOptionsAvailable)
            reasons.push(`${pair.high} option set restricted by lock`);
        if (low && !low.allOptionsAvailable)
            reasons.push(`${pair.low} option set restricted by lock`);
        const available = reasons.length === 0;
        dimension(key, { source: 'matched public pair', pairId: pair.pairId, events: [pair.high, pair.low],
            highChoice: high?.choiceId ?? null, lowChoice: low?.choiceId ?? null,
            highActionCredence: high?.actionCredence ?? null, lowActionCredence: low?.actionCredence ?? null,
            index: available ? high.actionCredence - low.actionCredence : 0, available, fallbackReasons: reasons });
    }
    const rows = exports.ACTOR_RULE.evidence.events.map((id) => decided.get(id)).filter((d) => d && d.allOptionsAvailable);
    const evidenceReasons = exports.ACTOR_RULE.evidence.events.filter((id) => !decided.get(id)).map((id) => `${id} not decided`)
        .concat(exports.ACTOR_RULE.evidence.events.filter((id) => decided.get(id) && !decided.get(id).allOptionsAvailable).map((id) => `${id} option set restricted by lock`));
    let slope = null, evidenceIndex = 0;
    const distinctQ = new Set(rows.map((r) => r.evidenceQuality));
    const evidenceAvailable = rows.length >= exports.ACTOR_RULE.evidence.minimumEvents && distinctQ.size >= 2;
    if (evidenceAvailable) {
        const mx = mean(rows.map((r) => r.evidenceQuality)), my = mean(rows.map((r) => r.actionCredence));
        const sxx = rows.reduce((a, r) => a + (r.evidenceQuality - mx) ** 2, 0);
        slope = rows.reduce((a, r) => a + (r.evidenceQuality - mx) * (r.actionCredence - my), 0) / sxx;
        evidenceIndex = clamp(slope * exports.ACTOR_RULE.evidence.t1DesignRange, -1, 1);
    }
    else if (rows.length && rows.length < exports.ACTOR_RULE.evidence.minimumEvents)
        evidenceReasons.push(`only ${rows.length} usable evidence events`);
    dimension('evidenceSensitivity', { source: 'public action slope on frozen evidence quality', events: exports.ACTOR_RULE.evidence.events,
        observations: rows.map((r) => ({ eventId: r.eventId, evidenceQuality: r.evidenceQuality, choiceId: r.choiceId, actionCredence: r.actionCredence })),
        rawSlope: slope, index: evidenceIndex, available: evidenceAvailable, fallbackReasons: evidenceReasons });
    const personalizedDimensions = Object.values(dimensions).filter((d) => d.available).length;
    return {
        source: 'actor-side public judgment decisions only (projected actor context); no T0, no private reads, no T1/T2, no Mirror output',
        ruleVersion: exports.ACTOR_RULE_VERSION, rule: exports.ACTOR_RULE,
        features: { judgmentDecisions: actorContext.judgmentDecisions, publicDecisionCount: actorContext.publicDecisions.length, actionCount: actorContext.actionCount },
        meanPublicActionCredence: actorContext.judgmentDecisions.length ? mean(actorContext.judgmentDecisions.map((d) => d.actionCredence)) : null,
        intercept: exports.ACTOR_RULE.intercept, dimensions,
        coverage: { personalizedDimensions, personalizedItems: personalizedDimensions * 2, fallbackItems: 8 - personalizedDimensions * 2,
            note: 'fallback items carry no actor information and must not be counted as actor predictions' },
    };
}
function checkBaseline(t0, targetForm) {
    if (!Array.isArray(t0) || t0.length !== 8)
        throw new Error('T0 must contain eight completed item-level responses');
    const seen = new Set(), forms = new Set();
    const rows = t0.map((row) => {
        const item = (0, cases_mjs_1.getCase)(row.caseId);
        if (item.form === targetForm)
            throw new Error('T0 form must be distinct from T1 holdout form');
        if (seen.has(item.id))
            throw new Error(`Duplicate T0 case: ${item.id}`);
        if (!Number.isFinite(row.score) || row.score < 0 || row.score > 100)
            throw new Error(`Invalid T0 score: ${item.id}`);
        seen.add(item.id);
        forms.add(item.form);
        // Explicit projection prevents arbitrary extra row properties reaching the model.
        return { caseId: item.id, form: item.form, dimension: item.dimension,
            features: { ...item.features }, score: row.score };
    });
    if (forms.size !== 1)
        throw new Error('T0 must use one complete parallel form');
    return rows;
}
function baselineModel(rows) {
    const n = rows.length, rawIntercept = mean(rows.map((r) => r.score / 100));
    const dimensions = {};
    for (const dimension of cases_mjs_1.DIMENSIONS) {
        const pair = rows.filter((r) => r.dimension === dimension);
        const feature = dimension === 'evidenceSensitivity' ? 'evidence' :
            dimension === 'partisanSymmetry' ? 'partisan' : dimension === 'crowdSusceptibility' ? 'crowd' : 'deniability';
        const ordered = [...pair].sort((a, b) => a.features[feature] - b.features[feature]);
        const rawValue = (ordered[1].score - ordered[0].score) / 100 /
            (ordered[1].features[feature] - ordered[0].features[feature]);
        const evidence = dimension === 'evidenceSensitivity';
        const weight = evidence ? shrink(2, exports.MODEL_SPEC.evidencePseudoCount) : shrink(1, exports.MODEL_SPEC.pairPseudoCount);
        const value = evidence ? clamp(rawValue, -1.2, 1.6) : clamp(rawValue, -1, 1);
        dimensions[dimension] = { rawValue, boundedValue: value, weight, coefficient: value * weight,
            n: evidence ? 2 : 1, available: true };
    }
    const weight = shrink(n, exports.MODEL_SPEC.interceptPseudoCount);
    return { source: 'T0 only', n, rawIntercept, interceptWeight: weight,
        intercept: 0.5 + weight * (rawIntercept - 0.5), dimensions };
}
function gameModel(coreState, gameLog) {
    const source = coreState?.state?.log ?? coreState?.st?.log ?? coreState?.log ??
        (Array.isArray(gameLog) ? gameLog : gameLog?.canonicalLog);
    if (!Array.isArray(source))
        throw new Error('Complete canonical in-game log is required for prediction');
    const inputReads = source.filter((r) => r.kind === 'read');
    const validReads = inputReads.filter((r) => Number.isInteger(r.credence) && r.credence >= 0 && r.credence <= 3 &&
        Number.isFinite(r.strength) && Number.isFinite(r.reliability));
    const moves = source.filter((r) => r.kind === 'move' && r.features && typeof r.features === 'object');
    // Frozen Mirror computation: observed n/conf and formulas are unchanged.
    const profile = (0, engine_mjs_1.analysePlayer)([...validReads, ...moves]);
    const dimensions = {};
    for (const key of cases_mjs_1.DIMENSIONS) {
        const dimension = profile.voter[key];
        const available = Number.isFinite(dimension.value) && dimension.n > 0;
        const weight = available ? shrink(dimension.n, key === 'evidenceSensitivity'
            ? exports.MODEL_SPEC.evidencePseudoCount : exports.MODEL_SPEC.pairPseudoCount) : 0;
        dimensions[key] = { rawValue: dimension.value, n: dimension.n, available,
            weight, coefficient: available ? dimension.value * weight : 0,
            descriptiveMirrorConfidence: dimension.conf };
    }
    const meanCredence = mean(validReads.map((r) => exports.MODEL_SPEC.credenceAnchors[r.credence]));
    const meanEvidence = mean(validReads.map((r) => r.strength * r.reliability));
    const evidenceSlope = dimensions.evidenceSensitivity.available ? dimensions.evidenceSensitivity.rawValue : 0;
    const rawIntercept = validReads.length ? clamp(meanCredence + evidenceSlope *
        (exports.MODEL_SPEC.evidenceReference - meanEvidence), 0, 1) : 0.5;
    const weight = shrink(validReads.length, exports.MODEL_SPEC.interceptPseudoCount);
    return {
        source: 'in-game private judgments only; political profile saved but not used as predictor',
        n: validReads.length, excludedReadCount: inputReads.length - validReads.length,
        meanCredence, meanEvidence, rawIntercept, interceptWeight: weight,
        intercept: 0.5 + weight * (rawIntercept - 0.5), dimensions,
        voterProfile: profile.voter, politicianProfile: profile.political,
        inputReadRecords: validReads.map((r) => ({ eventId: r.eventId ?? null,
            credence: r.credence, strength: r.strength, reliability: r.reliability,
            factor: r.factor ?? null, pairId: r.pairId ?? null, level: r.level ?? null })),
    };
}
function predict(model, item) {
    const d = model.dimensions, x = item.features;
    return 100 * clamp(model.intercept +
        d.evidenceSensitivity.coefficient * (x.evidence - exports.MODEL_SPEC.evidenceReference) +
        d.partisanSymmetry.coefficient * x.partisan +
        d.crowdSusceptibility.coefficient * x.crowd +
        d.deniabilitySusceptibility.coefficient * x.deniability, 0, 1);
}
function buildPredictionCommit(input) {
    const allowed = new Set(['participantId', 'sessionId', 'coreState', 'gameLog', 't0', 'form', 'studyVersion', 'coreHash', 'timestamp', 'actorContext']);
    for (const key of Object.keys(input ?? {})) {
        if (!allowed.has(key))
            throw new Error(`Prediction builder does not accept ${key}; T1/T2 data must never enter this API`);
    }
    const { participantId, sessionId, coreState, gameLog, t0, form, studyVersion, coreHash, timestamp, actorContext } = input ?? {};
    for (const [key, value] of Object.entries({ participantId, sessionId, studyVersion, coreHash })) {
        if (typeof value !== 'string' || !value)
            throw new Error(`Prediction commit requires ${key}`);
    }
    if (!((typeof timestamp === 'number' && Number.isFinite(timestamp)) ||
        (typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)))))
        throw new Error('Prediction timestamp is required');
    const items = (0, cases_mjs_1.getCases)(form);
    const baselineRows = checkBaseline(t0, form);
    const M1 = baselineModel(baselineRows);
    const M2 = gameModel(coreState, gameLog);
    const M3 = actorModel(actorContext);
    const predictions = items.map((item) => {
        const m1 = predict(M1, item), m2 = predict(M2, item), m3 = predict(M3, item);
        return { caseId: item.id, form, dimension: item.dimension,
            M0: { predictedScore: 50 }, M1: { predictedScore: m1 }, M2: { predictedScore: m2 },
            M3: { predictedScore: m3, personalized: M3.dimensions[item.dimension].available === true } };
    });
    return freezeDeep(clone({ schema: 'political-mirror-prediction-commit/1',
        participantId, sessionId, studyVersion, coreHash, timestamp, form,
        caseBankVersion: cases_mjs_1.CASE_BANK_VERSION, modelVersion: exports.MODEL_VERSION, actorRuleVersion: exports.ACTOR_RULE_VERSION,
        modelState: { spec: exports.MODEL_SPEC, M0: { constant: 50 }, M1, M2, M3,
            baselineRows, outcome: 'deliberate-wrongdoing probability judgment',
            predictiveConfidence: null, confidenceNote: 'No calibrated predictive intervals are estimated. Mirror confidence is descriptive coverage only.' },
        predictions,
    }));
}

}],
"pilot/actor-context.mjs": [{"../src/game-session.mjs":"src/game-session.mjs","../src/content.mjs":"src/content.mjs"}, function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_JUDGMENT_EVENTS = exports.ACTOR_CONTEXT_SCHEMA = void 0;
exports.extractPublicDecisionContext = extractPublicDecisionContext;
exports.validateActorContext = validateActorContext;
// Actor-side public decision context for M3 (0.38.1-pilot.1).
//
// This module is the only door through which gameplay reaches M3. It replays the frozen
// engine (read-only use of src/) and projects out ONLY public political decisions:
// which allowlisted public event was decided, which option was chosen, which options were
// actually selectable at that moment (locked options are recorded, never treated as
// preferences), and the frozen evidence design of the event. Private judgments
// (SUBMIT_PRIVATE_READ credences), reactions, election tallies and any post-game data are
// deliberately absent from the returned object. Tests assert that rewriting every private
// read leaves the context unchanged and that rewriting an allowlisted public choice changes it.
const game_session_mjs_1 = require("../src/game-session.mjs");
const content_mjs_1 = require("../src/content.mjs");
exports.ACTOR_CONTEXT_SCHEMA = 'pm-actor-context/1';
// Public "action credence" coding of the three-option structure shared by the frozen
// judgment events: act on the allegation as if credible (1), refer it to a process while
// withholding public judgment (0.5), dismiss/let it go/protect the target (0). The table is
// explicit so it can be audited against src/content.mjs; the extractor refuses an event whose
// option identifiers differ from this table.
// The pairs (P1/C1/D1) are design-matched prediction features: each pair contrasts one T1 factor, but the two events
// differ in career age, people, option costs, ability checks and consequences. They are not controlled manipulations,
// and the 1/0.5/0 coding below is a prospectively fixed design constant, not a calibrated parameter (M3_SCIENTIFIC_SPEC §3, §5).
exports.PUBLIC_JUDGMENT_EVENTS = Object.freeze({
    OPP_CONTRACT: Object.freeze({ pairId: 'P1', factor: 'PARTISAN', level: 'OPPOSING_SIDE', targetSide: 'OPPOSING_SIDE', coding: Object.freeze({ demand: 1, refer: 0.5, quiet: 0 }) }),
    ALLY_CONTRACT: Object.freeze({ pairId: 'P1', factor: 'PARTISAN', level: 'PLAYER_SIDE', targetSide: 'PLAYER_SIDE', coding: Object.freeze({ demand: 1, refer: 0.5, shield: 0 }) }),
    CROWD_LOUD: Object.freeze({ pairId: 'C1', factor: 'CROWD', level: 'CROWD_HIGH', targetSide: 'NON_PARTISAN', coding: Object.freeze({ ride: 1, process: 0.5, silent: 0 }) }),
    CROWD_QUIET: Object.freeze({ pairId: 'C1', factor: 'CROWD', level: 'CROWD_LOW', targetSide: 'NON_PARTISAN', coding: Object.freeze({ push: 1, process: 0.5, silent: 0 }) }),
    RECORDING_DENIABLE: Object.freeze({ pairId: 'D1', factor: 'DENIABILITY', level: 'DEN_HIGH', targetSide: 'NON_PARTISAN', coding: Object.freeze({ treat: 1, forensic: 0.5, dismiss: 0 }) }),
    RECORDING_CLEAN: Object.freeze({ pairId: 'D1', factor: 'DENIABILITY', level: 'DEN_LOW', targetSide: 'NON_PARTISAN', coding: Object.freeze({ treat: 1, forensic: 0.5, dismiss: 0 }) }),
    TIP_HOUSING: Object.freeze({ pairId: null, factor: 'EVIDENCE', level: null, targetSide: 'NON_PARTISAN', coding: Object.freeze({ push: 1, refer: 0.5, bin: 0 }) }),
    GRANT_QUESTION: Object.freeze({ pairId: null, factor: 'EVIDENCE', level: null, targetSide: 'NON_PARTISAN', coding: Object.freeze({ demand: 1, inquiry: 0.5, shrug: 0 }) }),
    SMEAR_RIVAL: Object.freeze({ pairId: null, factor: 'EVIDENCE', level: null, targetSide: 'OPPOSING_SIDE', coding: Object.freeze({ run: 1, verify: 0.5, pass: 0 }) }),
});
const round6 = (x) => Math.round(x * 1e6) / 1e6;
function beatIndex(player) {
    const index = new Map();
    for (const beat of (0, content_mjs_1.SCRIPT)(player))
        if (beat && beat.id)
            index.set(beat.id, beat);
    return index;
}
/**
 * Replays a saved transcript and returns the projected public decision context.
 * Options: { returnSession: true } also returns the replayed session so a caller that
 * must verify the canonical state does not replay twice.
 */
function extractPublicDecisionContext(spec, transcript, { returnSession = false } = {}) {
    if (!spec || !Array.isArray(transcript))
        throw new Error('Game spec and canonical transcript are required');
    const beats = beatIndex(spec.player);
    const session = (0, game_session_mjs_1.createGameSession)(spec);
    const publicDecisions = [];
    const judgmentDecisions = [];
    let actionIndex = 0;
    for (const entry of transcript) {
        const action = entry.action || entry;
        actionIndex += 1;
        if (action.type === game_session_mjs_1.ACTIONS.SELECT_PUBLIC_MOVE || action.type === game_session_mjs_1.ACTIONS.SELECT_WILDERNESS_ROUTE) {
            const interaction = (0, game_session_mjs_1.getCurrentInteraction)(session);
            const choices = (interaction.choices || []).map((c) => ({
                id: c.id, available: c.availability?.ok !== false,
                lockKind: c.availability?.ok === false ? (c.availability.kind || 'LOCKED') : null,
            }));
            const record = { actionIndex, eventId: action.beatId, choiceId: action.choiceId, choices };
            publicDecisions.push(record);
            const rule = exports.PUBLIC_JUDGMENT_EVENTS[action.beatId];
            if (rule && action.type === game_session_mjs_1.ACTIONS.SELECT_PUBLIC_MOVE) {
                const beat = beats.get(action.beatId);
                if (!beat || !beat.latents)
                    throw new Error(`Frozen script lacks judgment event ${action.beatId}`);
                const ids = choices.map((c) => c.id).sort().join(',');
                const coded = Object.keys(rule.coding).sort().join(',');
                if (ids !== coded)
                    throw new Error(`Option identifiers of ${action.beatId} (${ids}) differ from the M3 coding table (${coded})`);
                if (!(action.choiceId in rule.coding))
                    throw new Error(`Unknown public choice ${action.choiceId} at ${action.beatId}`);
                const chosen = choices.find((c) => c.id === action.choiceId);
                if (!chosen || !chosen.available)
                    throw new Error(`Chosen option ${action.choiceId} at ${action.beatId} was not selectable`);
                judgmentDecisions.push({
                    actionIndex, eventId: action.beatId, age: beat.age ?? null, choiceId: action.choiceId,
                    actionCredence: rule.coding[action.choiceId],
                    pairId: rule.pairId, factor: rule.factor, level: rule.level, targetSide: rule.targetSide,
                    evidenceQuality: round6(beat.latents.strength * beat.latents.reliability),
                    deniability: beat.latents.deniability ?? null,
                    crowdMagnitude: beat.latents.crowd ? beat.latents.crowd.magnitude : 0,
                    choices, allOptionsAvailable: choices.every((c) => c.available),
                });
            }
        }
        (0, game_session_mjs_1.dispatchGameAction)(session, action);
    }
    const context = {
        schema: exports.ACTOR_CONTEXT_SCHEMA, actionCount: actionIndex,
        publicDecisions, judgmentDecisions,
        codingTable: exports.PUBLIC_JUDGMENT_EVENTS,
        excluded: ['SUBMIT_PRIVATE_READ credences', 'reactions', 'election tallies', 'Mirror', 'T0/T1/T2', 'questionnaire'],
    };
    const plain = JSON.parse(JSON.stringify(context));
    return returnSession ? { context: plain, session } : plain;
}
function validateActorContext(context) {
    if (!context || context.schema !== exports.ACTOR_CONTEXT_SCHEMA)
        throw new Error('Actor context schema mismatch');
    if (!Array.isArray(context.judgmentDecisions) || !Array.isArray(context.publicDecisions))
        throw new Error('Actor context is incomplete');
    for (const d of context.judgmentDecisions) {
        const rule = exports.PUBLIC_JUDGMENT_EVENTS[d.eventId];
        if (!rule || rule.coding[d.choiceId] !== d.actionCredence)
            throw new Error(`Actor context coding mismatch at ${d.eventId}`);
        if (!Number.isFinite(d.evidenceQuality))
            throw new Error(`Actor context evidence quality missing at ${d.eventId}`);
        for (const key of Object.keys(d)) {
            if (/credence(?!Action)|read|score|t0|t1|t2|mirror|questionnaire/i.test(key) && key !== 'actionCredence')
                throw new Error(`Actor context carries a disallowed field: ${key}`);
        }
    }
    return true;
}

}]
};
const __cache = Object.create(null);
function __load(id) {
 if (__cache[id]) return __cache[id].exports;
 const definition = __modules[id];
 if (!definition) throw new Error('Unknown bundled module: ' + id);
 const module = {exports:{}}; __cache[id] = module;
 definition[1](module, module.exports, spec => {
 const target = definition[0][spec]; if (!target) throw new Error('Unresolved module: ' + spec); return __load(target);
 });
 return module.exports;
}
const collector = __load('pilot-cloud/worker.mjs').default;
export { collector as default };
