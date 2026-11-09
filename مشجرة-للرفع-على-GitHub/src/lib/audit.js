'use strict';
const { run } = require('../db');

function audit(req, action, entity = null, entityId = null, details = null) {
  run('INSERT INTO audit_log (actor_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)',
    req && req.user ? req.user.id : null,
    action, entity, entityId == null ? null : Number(entityId),
    details == null ? null : JSON.stringify(details),
    req ? req.ip : null);
}

module.exports = { audit };
