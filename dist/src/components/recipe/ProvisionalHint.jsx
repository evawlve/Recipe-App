"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvisionalHint = ProvisionalHint;
const react_1 = __importDefault(require("react"));
function ProvisionalHint({ provisional, provisionalReasons }) {
    if (!provisional) {
        return null;
    }
    return (<div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
      Provisional totals — {provisionalReasons.join('; ')}
    </div>);
}
