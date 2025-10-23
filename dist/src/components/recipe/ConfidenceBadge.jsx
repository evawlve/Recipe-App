"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ConfidenceBadge;
const react_1 = __importDefault(require("react"));
function ConfidenceBadge({ value }) {
    let tone = 'bg-gray-200 text-gray-800';
    let label = 'Low';
    if (value >= 0.7) {
        tone = 'bg-green-100 text-green-800';
        label = 'High';
    }
    else if (value >= 0.4) {
        tone = 'bg-amber-100 text-amber-800';
        label = 'Medium';
    }
    return (<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>
      <span className="tabular-nums">{Math.round(value * 100)}</span>
      <span>%</span>
      <span>• {label} confidence</span>
    </span>);
}
