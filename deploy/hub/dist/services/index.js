"use strict";
/**
 * Service exports.
 * 统一导出 hub services，便于集中引用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDefaultRules = exports.riskEngine = exports.RiskEngine = exports.initEventIntegration = exports.chatContextService = exports.ChatContextService = void 0;
var chat_context_1 = require("./chat-context");
Object.defineProperty(exports, "ChatContextService", { enumerable: true, get: function () { return chat_context_1.ChatContextService; } });
Object.defineProperty(exports, "chatContextService", { enumerable: true, get: function () { return chat_context_1.chatContextService; } });
var event_integration_1 = require("./event-integration");
Object.defineProperty(exports, "initEventIntegration", { enumerable: true, get: function () { return event_integration_1.initEventIntegration; } });
var risk_engine_1 = require("./risk-engine");
Object.defineProperty(exports, "RiskEngine", { enumerable: true, get: function () { return risk_engine_1.RiskEngine; } });
Object.defineProperty(exports, "riskEngine", { enumerable: true, get: function () { return risk_engine_1.riskEngine; } });
Object.defineProperty(exports, "initDefaultRules", { enumerable: true, get: function () { return risk_engine_1.initDefaultRules; } });
//# sourceMappingURL=index.js.map