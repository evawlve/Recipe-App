"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Logo;
const image_1 = __importDefault(require("next/image"));
function Logo({ withText = false, size = 'md', className = '' }) {
    const sizeClasses = {
        sm: 'h-8 w-8',
        md: 'h-14 w-14',
        lg: 'h-20 w-20'
    };
    const logoSrc = withText ? '/logo.svg' : '/logo-noLetters.svg';
    return (<div className={`${sizeClasses[size]} overflow-hidden flex items-center justify-center ${className}`}>
      <image_1.default src={logoSrc} alt="Mealspire Logo" width={180} height={180} className="h-36 w-36 object-contain translate-y-1 logo-dark-mode"/>
    </div>);
}
