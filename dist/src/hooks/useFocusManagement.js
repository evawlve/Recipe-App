"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useFocusManagement = useFocusManagement;
const react_1 = require("react");
function useFocusManagement(errors) {
    (0, react_1.useEffect)(() => {
        if (Object.keys(errors).length === 0)
            return;
        // Find the first field with an error
        const firstErrorField = Object.keys(errors)[0];
        // Focus the first invalid field
        const element = document.querySelector(`[name="${firstErrorField}"]`);
        if (element) {
            element.focus();
            element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [errors]);
}
