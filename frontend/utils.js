// utils.js

/**
 * Calculates distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Displays a customizable notification modal.
 * This function now relies on the `hospitalBedSystem` instance for modal control if available,
 * otherwise, it uses direct DOM manipulation as a fallback.
 * @param {string} message The message to display.
 * @param {'info'|'success'|'error'} type The type of notification.
 */
function showNotificationModal(message, type = 'info') {
    const modal = document.getElementById('notificationModal');
    const titleElement = document.getElementById('notificationModalTitle');
    const messageElement = document.getElementById('notificationModalMessage');

    if (!modal || !titleElement || !messageElement) {
        console.error("Notification modal elements not found.");
        return;
    }

    messageElement.textContent = message;
    let iconClass = 'fas fa-info-circle';
    let titleText = 'Notification';

    if (type === 'success') {
        iconClass = 'fas fa-check-circle';
        titleText = 'Success!';
    } else if (type === 'error') {
        iconClass = 'fas fa-times-circle';
        titleText = 'Error!';
    }

    titleElement.innerHTML = `<i class="${iconClass}"></i> ${titleText}`;

    // Use the HospitalBedSystem instance's showModal method if available
    // The `window.hospitalBedSystem` is set in script.js DOMContentLoaded.
    if (window.hospitalBedSystem && typeof window.hospitalBedSystem.showModal === 'function') {
        window.hospitalBedSystem.showModal('notificationModal');
    } else {
        // Fallback for initial page load on index.html where HospitalBedSystem might not be instantiated yet
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        // If there's an autofocus element inside, try to focus it
        const autofocusEl = modal.querySelector('[autofocus]');
        if (autofocusEl) autofocusEl.focus();
        else modal.focus(); // Focus modal itself if no autofocus element
    }
    // Update ARIA live region for screen readers
    const liveRegion = document.querySelector('.sr-only[aria-live="polite"]');
    if (liveRegion) {
        liveRegion.textContent = ''; // Clear previous message
        setTimeout(() => { // Small delay to ensure it's announced
            liveRegion.textContent = `${titleText}: ${message}`;
        }, 100);
    }
}

/**
 * Closes the generic notification modal.
 * This function now relies on the `hospitalBedSystem` instance for modal control if available,
 * otherwise, it uses direct DOM manipulation as a fallback.
 */
window.closeNotificationModal = () => {
    // Use the HospitalBedSystem instance's closeModal method if available
    if (window.hospitalBedSystem && typeof window.hospitalBedSystem.closeModal === 'function') {
        window.hospitalBedSystem.closeModal('notificationModal');
    } else {
        // Fallback if the class isn't initialized yet
        const modal = document.getElementById('notificationModal');
        if (modal) {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
        }
    }
};

// Map of hospital names to their approximate coordinates in Ghana
const hospitalCoordsMap = {
    // Greater Accra Region
    "korle bu teaching hospital": [5.5450, -0.2250],
    "37 military hospital": [5.5898, -0.1818],
    "greater accra regional hospital (ridge)": [5.5616, -0.1987],
    "tema general hospital": [5.6667, 0.0167],
    "lekma hospital": [5.6022, -0.1169],
    "ga east municipal hospital": [5.6766, -0.2315],
    "police hospital": [5.5801, -0.1916],
    "university of ghana hospital": [5.6508, -0.1871],

    // Ashanti Region
    "komfo anokye teaching hospital": [6.6925, -1.6307],
    "manhyia government hospital": [6.7102, -1.6163],
    "suntreso government hospital": [6.6898, -1.6435],
    "tafo government hospital": [6.7328, -1.6095],
    "kumasi south hospital": [6.6623, -1.6131],
    "agogo presbyterian hospital": [6.7914, -1.0716],
    "tepa government hospital": [7.0119, -2.1866],
    "bekwai government hospital": [6.4522, -1.5791],
    "obuasi government hospital": [6.1989, -1.6669],
    "mampong government hospital": [7.0603, -1.4013],

    // Western Region
    "effia nkwanta regional hospital": [4.9085, -1.7744],
    "takoradi hospital": [4.8931, -1.7583],
    "tarkwa municipal hospital": [5.3021, -1.9892],
    "axim government hospital": [4.8697, -2.2415],

    // Central Region
    "cape coast teaching hospital": [5.1054, -1.2882],
    "winneba government hospital": [5.3567, -0.6231],
    "kasoa polyclinic": [5.5348, -0.4287],
    "assin foso st. francis xavier hospital": [5.7000, -1.2833],
    "dunkwa-on-offin government hospital": [5.9675, -1.7788],
    "swedru government hospital": [5.5372, -0.7002],

    // Eastern Region
    "koforidua regional hospital": [6.0950, -0.2630],
    "tetteh quarshie memorial hospital": [6.2000, -0.0500],
    "atua government hospital": [6.2333, 0.0000],
    "suhum government hospital": [5.9333, -0.4500],
    "nkawkaw holy family hospital": [6.5500, -0.7667],

    // Volta Region
    "ho teaching hospital": [6.6116, 0.4728],
    "ho municipal hospital": [6.6020, 0.4670],
    "keta municipal hospital": [5.9221, 0.9922],
    "hohoe municipal hospital": [7.1519, 0.4779],

    // Oti Region
    "worawora government hospital": [7.4996, 0.3155],
    "krachi west district hospital": [7.8016, -0.0560],

    // Bono Region
    "sunyani regional hospital": [7.3292, -2.3168],
    "wenchi methodist hospital": [7.7428, -2.1027],
    "berekum holy family hospital": [7.4528, -2.5833],
    "dormaa presbyterian hospital": [7.2801, -2.8767],
    "sampa government hospital": [8.1133, -2.7001],

    // Ahafo Region
    "goaso government hospital": [6.8045, -2.5209],
    "st. elizabeth hospital": [6.9933, -2.3486], // Hwidiem
    "kenyasi government hospital": [7.0898, -2.3025],
    "st. john of god hospital, duayaw nkwanta": [7.1833, -2.0667],

    // Bono East Region
    "techiman holy family hospital": [7.5856, -1.9317],
    "kintampo municipal hospital": [8.0556, -1.7335],
    "nkoranza st. theresa's hospital": [7.5739, -1.7011],
    "yeji mathias catholic hospital": [8.2323, -0.9922],
    "atebubu government hospital": [7.7554, -0.9882],

    // Northern Region
    "tamale teaching hospital": [9.4146, -0.8624],
    "tamale central hospital": [9.4035, -0.8532],
    "tamale west hospital": [9.4211, -0.8755],
    "yendi municipal hospital": [9.4449, -0.0069],

    // Savannah Region
    "damongo hospital": [9.0833, -1.8167],
    "salaga government hospital": [8.5528, -0.5201],

    // North East Region
    "walewale municipal hospital": [10.3582, -0.8037],
    "baptist medical centre, nalerigu": [10.5167, -0.3667],

    // Upper East Region
    "bolgatanga regional hospital": [10.7850, -0.8528],
    "bawku presbyterian hospital": [11.0619, -0.2443],
    "war memorial hospital, navrongo": [10.8925, -1.0913],

    // Upper West Region
    "wa regional hospital": [10.0594, -2.5085],
    "jirapa st. joseph's hospital": [10.5283, -2.6936],
    "nandom hospital": [10.8600, -2.7600],

    // Western North
    "sefwi wiawso government hospital": [6.2167, -2.4833],
    "bibiani government hospital": [6.4673, -2.3204]
};

/**
 * Gets the coordinates for a specific hospital by looking up its name.
 * Converts input name to lowercase and trims whitespace for robust matching.
 * @param {string} hospitalName The full name of the hospital.
 * @returns {Array<number>|null} An array containing [latitude, longitude] or null if not found.
 */
function getHospitalCoords(hospitalName) {
    if (!hospitalName) return null;
    const nameKey = hospitalName.toLowerCase().trim();
    const coords = hospitalCoordsMap[nameKey] || null;
    if (!coords) {
        console.warn(`Coordinates not found in map for hospital: "${hospitalName}"`);
    }
    return coords;
}
