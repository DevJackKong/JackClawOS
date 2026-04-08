"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskCheckMiddleware = exports.auditLoggerMiddleware = exports.rbacGuard = exports.tenantContextMiddleware = void 0;
/**
 * Tenant context middleware:
 * resolves tenant / org / user context from the incoming request.
 */
var tenant_context_1 = require("./tenant-context");
Object.defineProperty(exports, "tenantContextMiddleware", { enumerable: true, get: function () { return tenant_context_1.tenantContextMiddleware; } });
/**
 * RBAC guard middleware:
 * checks whether the current user can perform an action on a resource.
 */
var rbac_guard_1 = require("./rbac-guard");
Object.defineProperty(exports, "rbacGuard", { enumerable: true, get: function () { return rbac_guard_1.rbacGuard; } });
/**
 * Risk check middleware:
 * evaluates write operations and decides block / approval / warning.
 */
/**
 * Audit logger middleware:
 * records important write operations into the audit log.
 */
var audit_logger_1 = require("./audit-logger");
Object.defineProperty(exports, "auditLoggerMiddleware", { enumerable: true, get: function () { return audit_logger_1.auditLoggerMiddleware; } });
var risk_check_1 = require("./risk-check");
Object.defineProperty(exports, "riskCheckMiddleware", { enumerable: true, get: function () { return risk_check_1.riskCheckMiddleware; } });
//# sourceMappingURL=index.js.map