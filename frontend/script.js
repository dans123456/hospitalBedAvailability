class HospitalBedSystem {
  constructor() {
    this.hospitals = [];
    this.map = null;
    this.markers = new Map();
    this.currentFilter = "all"; // Not directly used, but can be for future overall filter state
    this.searchTerm = "";
    this.sortOrder = "latest";
    this.regionFilter = "";
    this.searchDebounce = null;
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.loadingMarkers = false; // Flag to prevent excessive map marker updates
    this.editingHospitalId = null; // Stores the ID of the hospital currently being edited
    this.availabilityChart = null; // Chart.js instance for trends
    this.bedTypeFilter = null; // Filter for ICU or Regular beds with availability
    this.distanceFilter = null; // Filter for distance from user
    this.userLocation = null; // Stores user's geolocation

    // Setup ARIA live region for screen reader announcements
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.className = 'sr-only'; // Hidden visually but accessible to screen readers
    document.body.appendChild(this.liveRegion);

    this.init(); // Initialize the system
  }

  /**
   * Initializes the application by checking admin status, setting up event listeners,
   * initializing the map, fetching data, and starting auto-refresh.
   */
  async init() {
    this.checkAdminStatus();
    this.setupEventListeners();
    this.initializeMap();
    await this.fetchAndRenderAll(); // Fetch and render data initially
    this.startAutoRefresh(); // Start periodic data refresh
    this.initCharts(); // Initialize the chart for bed availability trends
    this.setupAdvancedFilters(); // Setup event listeners for bed type and distance filters
  }

  /**
   * Initializes the Leaflet map.
   * Prevents re-initialization if map already exists.
   */
  initializeMap() {
    if (this.map) return; // Map already initialized
    const mapElement = document.getElementById('map');
    if (mapElement) {
      this.map = L.map('map').setView([7.9465, -1.0232], 7); // Set view to Ghana coordinates
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(this.map);
    }
  }

  /**
   * Initializes Chart.js for bed availability trends.
   */
  initCharts() {
    const ctx = document.getElementById('availabilityChart');
    if (ctx) {
      this.availabilityChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [], // Dates will go here
          datasets: [{
            label: 'ICU Beds',
            borderColor: '#e53e3e',
            backgroundColor: 'rgba(229, 62, 62, 0.2)',
            fill: true,
            data: []
          }, {
            label: 'Regular Beds',
            borderColor: '#38a169',
            backgroundColor: 'rgba(56, 161, 105, 0.2)',
            fill: true,
            data: []
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
            },
            title: {
              display: true,
              text: '7-Day Bed Availability Trend (Overall)'
            }
          },
          scales: {
            x: {
              type: 'time', // Use time scale for dates
              time: {
                unit: 'day',
                tooltipFormat: 'MMM dd,yyyy', // Example: Jul 01, 2025
                displayFormats: {
                  day: 'MMM d' // Example: Jul 1
                }
              },
              title: {
                display: true,
                text: 'Date'
              }
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Number of Beds'
              }
            }
          }
        }
      });
    }
  }

  /**
   * Updates the Chart.js graph with historical data.
   * This currently simulates data as a dedicated backend endpoint for overall history is not available.
   */
  async updateCharts() {
    try {
        // Use the deployed backend URL for fetching hospital data
        const response = await fetch('https://hospital-bed-backend-154014254128.us-central1.run.app/api/hospitals');
        if (!response.ok) throw new Error('Failed to fetch hospital data for charts');
        const hospitals = await response.json();

        const totalICUBeds = hospitals.reduce((sum, h) => sum + h.icu_beds, 0);
        const totalRegularBeds = hospitals.reduce((sum, h) => sum + h.regular_beds, 0);
        const labels = [];
        const icuData = [];
        const regularData = [];

        // Simulate 7 days of data for the chart based on the most recent total.
        // A real implementation would fetch proper historical sums from a backend endpoint.
        const numDays = 7;
        for (let i = numDays - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toISOString().split('T')[0]); // YYYY-MM-DD
            // Add slight random variation to simulate trends
            icuData.push(Math.max(0, totalICUBeds + Math.floor(Math.random() * 10 - 5)));
            regularData.push(Math.max(0, totalRegularBeds + Math.floor(Math.random() * 20 - 10)));
        }

        if (this.availabilityChart) {
          this.availabilityChart.data.labels = labels;
          this.availabilityChart.data.datasets[0].data = icuData;
          this.availabilityChart.data.datasets[1].data = regularData;
          this.availabilityChart.update();
        }

    } catch (error) {
        console.error("Error updating charts:", error);
        // You might want to display a message to the user here
        window.showNotificationModal("Failed to load chart data.", "error");
    }
  }


  /**
   * Sets up all global and element-specific event listeners.
   */
  setupEventListeners() {
    const form = document.getElementById("hospitalForm");
    if (form) form.addEventListener("submit", this.handleFormSubmit.bind(this));

    const logoutBtn = document.getElementById("logoutButton");
    if (logoutBtn) logoutBtn.addEventListener("click", this.logoutAdmin.bind(this));

    const hospitalSearchInput = document.getElementById("hospitalSearch");
    if (hospitalSearchInput) hospitalSearchInput.addEventListener("input", this.handleSearchInput.bind(this));

    const sortOrderSelect = document.getElementById("sortOrder");
    if (sortOrderSelect) sortOrderSelect.addEventListener("change", this.handleSortChange.bind(this));

    const regionFilterSelect = document.getElementById("regionFilter");
    if (regionFilterSelect) regionFilterSelect.addEventListener("change", this.handleRegionFilterChange.bind(this));

    const hospitalsList = document.getElementById("hospitalsList");
    if (hospitalsList) {
      hospitalsList.addEventListener("click", (e) => {
        const locationLink = e.target.closest('.hospital-location-link');
        if (locationLink) {
          this.handleLocationClick(e);
          return; // Stop if it's a location link
        }

        const editButton = e.target.closest('.btn-edit');
        if (editButton) {
          const hospitalId = editButton.dataset.hospitalId;
          this.editHospital(hospitalId);
          return; // Stop if it's an edit button
        }

        const deleteButton = e.target.closest('.btn-delete');
        if (deleteButton) {
          const hospitalId = deleteButton.dataset.hospitalId;
          this.confirmDeleteHospital(hospitalId); // Use confirmation modal
          return; // Stop if it's a delete button
        }
      });
    }

    // Add keyboard event listeners for accessibility (modal focus trap, escape to close)
    document.addEventListener('keydown', (e) => {
      // Close active modal on Escape key
      if (e.key === 'Escape') {
        this.closeActiveModal();
      }
      // Trap focus within active modal for Tab key
      if (e.key === 'Tab' && document.querySelector('.modal[aria-hidden="false"]')) {
        this.trapModalFocus(e);
      }
    });

    // Event listener for the confirm delete button inside the delete modal
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    if (confirmDeleteBtn) {
        // Ensure this event listener is only added once
        if (!confirmDeleteBtn.__listenerAdded) {
            confirmDeleteBtn.addEventListener('click', (e) => {
                const hospitalIdToDelete = e.target.dataset.hospitalId;
                if (hospitalIdToDelete) {
                    this.deleteHospital(hospitalIdToDelete);
                }
            });
            confirmDeleteBtn.__listenerAdded = true;
        }
    }
  }

  /**
   * Sets up event listeners for advanced filtering options (bed type, distance).
   */
  setupAdvancedFilters() {
    const bedTypeFilter = document.getElementById('bedTypeFilter');
    const distanceFilter = document.getElementById('distanceFilter');

    if (bedTypeFilter) {
      bedTypeFilter.addEventListener('change', (e) => {
        this.bedTypeFilter = e.target.value;
        this.currentPage = 1; // Reset to first page on filter change
        this.renderHospitalsList();
      });
    }

    if (distanceFilter) {
      distanceFilter.addEventListener('change', (e) => {
        this.distanceFilter = e.target.value;
        this.currentPage = 1; // Reset to first page on filter change
        if (this.distanceFilter) { // Only request geolocation if a distance filter is selected
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              position => this.filterByLocation(position),
              error => {
                console.error("Geolocation error:", error);
                window.showNotificationModal("Could not get your location for distance filtering.", "error");
                this.userLocation = null; // Clear user location on error
                this.renderHospitalsList(); // Re-render without distance filter
              }, {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
              }
            );
          } else {
            window.showNotificationModal("Geolocation is not supported by your browser.", "error");
            this.userLocation = null; // Clear user location if not supported
            this.renderHospitalsList(); // Re-render without distance filter
          }
        } else {
          // If distance filter is cleared, remove user location and re-render
          this.userLocation = null;
          this.renderHospitalsList();
        }
      });
    }
  }

  /**
   * Sets the user's current location for distance filtering.
   * @param {Object} position - GeolocationPosition object.
   */
  filterByLocation(position) {
    this.userLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
    window.showNotificationModal(`Location obtained: ${this.userLocation.lat.toFixed(2)}, ${this.userLocation.lng.toFixed(2)}`, 'info');
    this.renderHospitalsList();
  }

  /**
   * Traps keyboard focus within an active modal for accessibility.
   * @param {Event} e - The keyboard event.
   */
  trapModalFocus(e) {
    const modal = document.querySelector('.modal[aria-hidden="false"]');
    if (!modal) return; // No active modal

    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return; // No focusable elements in modal

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }

  /**
   * Closes the currently active modal.
   */
  closeActiveModal() {
    const activeModal = document.querySelector('.modal[aria-hidden="false"]');
    if (activeModal) {
      this.closeModal(activeModal.id);
    }
  }

  /**
   * Displays a modal by setting its display style to 'flex' and updating ARIA attributes.
   * @param {string} modalId - The ID of the modal element to show.
   */
  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
      console.error(`Modal with ID "${modalId}" not found.`);
      return;
    }

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.focus(); // Give focus to the modal itself

    // Focus on first autofocus element if available, or the modal itself
    const autofocusEl = modal.querySelector('[autofocus]');
    if (autofocusEl) {
      autofocusEl.focus();
    } else {
      modal.focus(); // Make sure modal itself is focusable if no child has autofocus
    }

    document.body.classList.add('modal-open'); // Add class to body to disable scrolling
  }

  /**
   * Hides a modal by setting its display style to 'none' and updating ARIA attributes.
   * @param {string} modalId - The ID of the modal element to hide.
   */
  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
      console.error(`Modal with ID "${modalId}" not found.`);
      return;
    }

    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open'); // Remove class from body to re-enable scrolling
  }


  // ========== VALIDATION METHODS ========== //
  /**
   * Validates hospital form data.
   * @param {Object} data - The form data object.
   * @returns {Object} An object containing validation errors, if any.
   */
  validateFormData(data) {
    const errors = {};
    const validRegions = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central",
                         "Eastern", "Greater Accra", "North East", "Northern",
                         "Oti", "Savannah", "Upper East", "Upper West",
                         "Volta", "Western", "Western North"
    ];

    if (!data.name || data.name.trim().length < 3) {
      errors.name = "Hospital name must be at least 3 characters.";
    }

    if (!data.region || !validRegions.includes(data.region)) {
      errors.region = "Please select a valid region.";
    }

    if (isNaN(data.icuBeds) || data.icuBeds < 0) {
      errors.icuBeds = "ICU beds must be zero or a positive number.";
    }
    if (isNaN(data.regularBeds) || data.regularBeds < 0) {
      errors.regularBeds = "Regular beds must be zero or a positive number.";
    }

    if (data.contactInfo && !/^[\d\s+()-]+$/.test(data.contactInfo)) {
      errors.contactInfo = "Invalid phone/contact format.";
    }

    if (data.location && data.location.length > 100) {
      errors.location = "Location too long (max 100 characters).";
    }

    return errors;
  }

  /**
   * Displays validation errors on the form.
   * @param {Object} errors - Object containing field names and their error messages.
   */
  showValidationErrors(errors) {
    // Clear previous errors
    document.querySelectorAll('.error-message').forEach(el => el.remove());
    document.querySelectorAll('.form-control').forEach(el => el.classList.remove('error'));

    // Display new errors
    for (const [field, message] of Object.entries(errors)) {
      const input = document.querySelector(`[name="${field}"]`);
      if (!input) continue;

      input.classList.add('error');
      const errorEl = document.createElement('div');
      errorEl.className = 'error-message';
      errorEl.textContent = message;
      // Find the parent form-group to append the error message
      const formGroup = input.closest('.form-group');
      if (formGroup) {
        formGroup.appendChild(errorEl);
      }
    }
    // Announce errors to screen readers
    this.liveRegion.textContent = `Form has errors: ${Object.values(errors).join('. ')}`;
  }
  // ========== END VALIDATION METHODS ========== //


  /**
   * Handles hospital form submission (add new or update existing).
   * @param {Event} e - The form submission event.
   */
  async handleFormSubmit(e) {
    e.preventDefault();
    if (!this.isAdmin()) {
      window.showNotificationModal("You must be logged in as an administrator to submit data.", "error");
      return;
    }

    // Get form data
    const formData = {
      name: document.getElementById('hospitalName').value.trim(),
      region: document.getElementById('region').value,
      icuBeds: parseInt(document.getElementById('icuBeds').value) || 0,
      regularBeds: parseInt(document.getElementById('regularBeds').value) || 0,
      contactInfo: document.getElementById('contactInfo').value.trim(),
      location: document.getElementById('location').value.trim()
    };

    // Validate form data client-side
    const errors = this.validateFormData(formData);
    if (Object.keys(errors).length > 0) {
      this.showValidationErrors(errors);
      window.showNotificationModal("Please correct the form errors.", "error");
      return;
    }

    const submitButton = e.submitter || document.querySelector('.submit-btn'); // Get the button that triggered submission
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    }


    try {
      // Use the deployed backend URL for form submissions
      const url = `https://hospital-bed-backend-154014254128.us-central1.run.app/api/hospitals`;

      const response = await fetch(url, {
        method: "POST", // Backend uses POST for both insert/update based on name
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to ${this.editingHospitalId ? "update" : "add"} hospital.`);
      }

      window.showNotificationModal(`Hospital data ${this.editingHospitalId ? "updated" : "submitted"} successfully!`, "success");
      e.target.reset(); // Clear the form
      this.editingHospitalId = null; // Clear editing state
      document.querySelector('.submit-btn').innerHTML = '<i class="fas fa-paper-plane"></i> Submit Availability'; // Reset button text
      await this.fetchAndRenderAll(); // Refresh data
    } catch (error) {
      console.error("Submission error:", error);
      window.showNotificationModal(`Error: ${error.message}`, "error");
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Availability'; // Reset button text and icon
            // If still in editing state (e.g. error, but form not cleared), keep "Update" text
            if (this.editingHospitalId) {
                 submitButton.innerHTML = '<i class="fas fa-paper-plane"></i> Update Availability';
            }
        }
        document.querySelectorAll('.error-message').forEach(el => el.remove()); // Clear errors on submit attempt
        document.querySelectorAll('.form-control').forEach(el => el.classList.remove('error'));
    }
  }

  /**
   * Handles click on a hospital location link, flying the map to its location.
   * @param {Event} e - The click event.
   */
  handleLocationClick(e) {
    const locationLink = e.target.closest('.hospital-location-link');
    if (!locationLink) return;

    e.preventDefault();
    const hospitalId = parseInt(locationLink.dataset.hospitalId, 10);
    if (isNaN(hospitalId)) return;

    const marker = this.markers.get(hospitalId);

    if (marker && this.map) {
      const latLng = marker.getLatLng();
      this.map.flyTo(latLng, 15); // Fly to marker location with zoom level 15
      marker.openPopup(); // Open the marker's popup
    } else {
      console.warn(`Marker not found for hospital ID: ${hospitalId}`);
    }
  }

  /**
   * Fetches all hospital data, renders the list, updates map markers, and statistics.
   */
  async fetchAndRenderAll() {
    await this.fetchHospitals(); // Fetch data based on current search/filter
    this.renderHospitalsList(); // Render the filtered/sorted list
    this.updateMapMarkers(); // Update markers on the map
    this.updateStats(); // Update total bed statistics
    this.updateCharts(); // Update the trends chart
  }

  /**
   * Fetches hospital data from the backend API, applying search and region filters.
   */
  async fetchHospitals() {
    const params = new URLSearchParams();
    if (this.searchTerm) params.append('search', this.searchTerm);
    if (this.regionFilter) params.append('region', this.regionFilter);

    // Use the deployed backend URL for fetching hospital data
    const url = `https://hospital-bed-backend-154014254128.us-central1.run.app/api/hospitals?${params.toString()}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      this.hospitals = await response.json();
    } catch (error) {
      console.error("Error fetching hospital data:", error);
      window.showNotificationModal("Could not load hospital data. Please check your server connection.", "error");
      this.hospitals = []; // Clear hospitals on error
    }
  }

  /**
   * Handles search input, debouncing to prevent excessive API calls.
   * @param {Event} e - The input event.
   */
  handleSearchInput(e) {
    this.searchTerm = e.target.value.toLowerCase().trim();
    this.currentPage = 1; // Reset to first page on search
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.fetchAndRenderAll();
    }, 300); // Debounce for 300ms
  }

  /**
   * Handles sort order change and re-renders the hospital list.
   * @param {Event} e - The change event.
   */
  handleSortChange(e) {
    this.sortOrder = e.target.value;
    this.currentPage = 1; // Reset to first page on sort change
    this.renderHospitalsList();
  }

  /**
   * Handles region filter change and refetches/renders all hospitals.
   * @param {Event} e - The change event.
   */
  handleRegionFilterChange(e) {
    this.regionFilter = e.target.value;
    this.currentPage = 1; // Reset to first page on filter change
    this.fetchAndRenderAll(); // Refetch data as region filter is server-side
  }

  /**
   * Populates the form with a hospital's data for editing.
   * @param {string} hospitalId - The ID of the hospital to edit.
   */
  editHospital(hospitalId) {
    const hospital = this.hospitals.find(h => h.id == hospitalId);
    if (!hospital) {
      window.showNotificationModal("Hospital not found for editing.", "error");
      return;
    }

    this.editingHospitalId = hospital.id; // Set editing state

    // Populate form fields
    document.getElementById('hospitalName').value = hospital.name;
    document.getElementById('region').value = hospital.region;
    document.getElementById('icuBeds').value = hospital.icu_beds;
    document.getElementById('regularBeds').value = hospital.regular_beds;
    document.getElementById('contactInfo').value = hospital.contact_info;
    document.getElementById('location').value = hospital.location;

    // Change button text to indicate update mode
    document.querySelector('.submit-btn').innerHTML = '<i class="fas fa-paper-plane"></i> Update Availability';

    // Scroll to the top of the page to show the form
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });

    // Briefly highlight the form
    const formCard = document.querySelector('.submission-section .card');
    if (formCard) {
      formCard.style.transition = 'all 0.3s ease';
      formCard.style.boxShadow = '0 0 15px rgba(102, 126, 234, 0.5)';
      setTimeout(() => {
        formCard.style.boxShadow = '';
      }, 1500);
    }
  }

  /**
   * Shows a confirmation modal before deleting a hospital.
   * @param {string} hospitalId - The ID of the hospital to delete.
   */
  confirmDeleteHospital(hospitalId) {
    const deleteModal = document.getElementById('deleteConfirmationModal');
    const deleteConfirmBtn = document.getElementById('confirmDeleteBtn');

    if (deleteModal && deleteConfirmBtn) {
      // Store the ID on the button or modal itself
      deleteConfirmBtn.dataset.hospitalId = hospitalId;
      this.showModal('deleteConfirmationModal');
    }
  }

  /**
   * Deletes a hospital entry from the database.
   * This is called after user confirms in the modal.
   * @param {string} hospitalId - The ID of the hospital to delete.
   */
  async deleteHospital(hospitalId) {
    this.closeModal('deleteConfirmationModal'); // Close confirmation modal

    try {
      // Use the deployed backend URL for delete operations
      const response = await fetch(`https://hospital-bed-backend-154014254128.us-central1.run.app/api/hospitals/${hospitalId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Server error');
      }

      window.showNotificationModal('Hospital deleted successfully!', 'success');
      await this.fetchAndRenderAll(); // Refresh the list
    } catch (error) {
      console.error("Deletion error:", error);
      window.showNotificationModal(`Failed to delete hospital: ${error.message}`, 'error');
    }
  }

  /**
   * Filters and sorts the hospitals, then renders them to the list.
   * Also handles pagination.
   */
  renderHospitalsList() {
    let filtered = [...this.hospitals];

    // Apply search filter (already done in fetchHospitals if server-side)
    // If search was client-side:
    // if (this.searchTerm) {
    //     filtered = filtered.filter(hospital =>
    //         hospital.name.toLowerCase().includes(this.searchTerm)
    //     );
    // }

    // Apply region filter (already done in fetchHospitals if server-side)
    // If region filter was client-side:
    // if (this.regionFilter) {
    //     filtered = filtered.filter(hospital =>
    //         hospital.region === this.regionFilter
    //     );
    // }

    // Apply bed type filter (client-side)
    if (this.bedTypeFilter === 'icu') {
      filtered = filtered.filter(h => h.icu_beds > 0);
    } else if (this.bedTypeFilter === 'regular') {
      filtered = filtered.filter(h => h.regular_beds > 0);
    }

    // Apply distance filter (client-side)
    if (this.userLocation && this.distanceFilter && this.distanceFilter !== 'all') {
      const maxDistance = parseInt(this.distanceFilter);
      if (!isNaN(maxDistance)) {
        filtered = filtered.filter(hospital => {
          const hospitalCoords = getHospitalCoords(hospital.name); // global from utils.js
          if (!hospitalCoords) return false;

          const distance = calculateDistance( // global from utils.js
            this.userLocation.lat,
            this.userLocation.lng,
            hospitalCoords[0],
            hospitalCoords[1]
          );
          return distance <= maxDistance;
        });
      }
    }


    // Apply sorting
    filtered.sort((a, b) => {
      switch (this.sortOrder) {
        case "latest":
          return new Date(b.timestamp) - new Date(a.timestamp);
        case "oldest":
          return new Date(a.timestamp) - new Date(b.timestamp);
        case "nameAsc":
          return a.name.localeCompare(b.name);
        case "nameDesc":
          return b.name.localeCompare(a.name);
        case "icuHigh":
          return b.icu_beds - a.icu_beds;
        case "regularHigh":
          return b.regular_beds - a.regular_beds;
        default:
          return 0;
      }
    });

    const hospitalsList = document.getElementById("hospitalsList");
    if (!hospitalsList) return;

    // Pagination
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const paginatedHospitals = filtered.slice(startIndex, endIndex);

    if (paginatedHospitals.length > 0) {
      hospitalsList.innerHTML = paginatedHospitals.map(hospital => this.getHospitalHTML(hospital)).join('');
    } else {
      hospitalsList.innerHTML = this.getEmptyStateHTML(filtered.length === 0);
    }
    this.renderPaginationControls(filtered.length); // Render pagination
  }

  /**
   * Renders pagination controls (Previous/Next buttons and page info).
   * @param {number} totalItems - The total number of items after filtering.
   */
  renderPaginationControls(totalItems) {
    const totalPages = Math.ceil(totalItems / this.itemsPerPage);
    const container = document.querySelector('.availability-list-section .card'); // Use a more specific selector
    let controls = container ? container.querySelector('.pagination-controls') : null;

    if (!container) {
        console.error("Pagination container not found.");
        return;
    }

    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'pagination-controls';
      container.appendChild(controls);
    }

    controls.innerHTML = `
      <button ${this.currentPage <= 1 ? 'disabled' : ''}
              class="btn-secondary page-btn" id="prevPage" aria-label="Previous page">
        <i class="fas fa-chevron-left"></i> Previous
      </button>
      <span class="page-info" aria-live="polite">Page ${this.currentPage} of ${totalPages || 1}</span>
      <button ${this.currentPage >= totalPages ? 'disabled' : ''}
              class="btn-secondary page-btn" id="nextPage" aria-label="Next page">
        Next <i class="fas fa-chevron-right"></i>
      </button>
    `;

    // Re-attach event listeners as innerHTML overwrites them
    // Use optional chaining for safety, as elements might not exist immediately after innerHTML
    document.getElementById('prevPage')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderHospitalsList();
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    });

    document.getElementById('nextPage')?.addEventListener('click', () => {
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.renderHospitalsList();
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    });
  }

  /**
   * Updates markers on the Leaflet map based on current hospital data.
   * Optimized to only add/remove markers for hospitals currently in view.
   */
  updateMapMarkers() {
    if (!this.map) return;

    // Clear existing markers to prevent duplicates
    this.markers.forEach(marker => marker.remove());
    this.markers.clear();

    const bounds = this.map.getBounds(); // Get current map view bounds

    // Add markers only for hospitals within the current view
    this.hospitals.forEach(hospital => {
      if (!hospital.name || !hospital.id) return;

      const coords = getHospitalCoords(hospital.name); // global from utils.js
      if (!coords) return; // Skip if coordinates are not found

      // Only add marker if it's within the current map bounds OR if it's currently being edited
      // This optimization helps with performance for very large datasets
      if (bounds.contains(coords) || this.editingHospitalId === hospital.id) {
        const marker = L.marker(coords).addTo(this.map)
          .bindPopup(`<b>${this.escapeHtml(hospital.name)}</b><br>
                      ICU Beds: ${hospital.icu_beds}<br>
                      Regular Beds: ${hospital.regular_beds}<br>
                      Updated: ${new Date(hospital.timestamp).toLocaleString()}`);
        this.markers.set(hospital.id, marker);
      }
    });

    // Re-add moveend listener to update markers when map view changes
    // Ensure this listener is added only once or handled carefully to avoid multiple calls
    if (!this.map.__moveendListenerAdded) {
        this.map.on('moveend', () => {
            // Debounce the marker update to avoid frequent re-renders during map drag/zoom
            if (!this.loadingMarkers) {
                this.loadingMarkers = true;
                setTimeout(() => {
                    this.updateMapMarkers(); // Re-render markers for the new view
                    this.loadingMarkers = false;
                }, 300);
            }
        });
        this.map.__moveendListenerAdded = true; // Flag to indicate listener is added
    }
  }


  /**
   * Updates the total statistics displayed on the dashboard.
   */
  updateStats() {
    const totalHospitals = this.hospitals.length;
    const totalICUBeds = this.hospitals.reduce((sum, h) => sum + h.icu_beds, 0);
    const totalRegularBeds = this.hospitals.reduce((sum, h) => sum + h.regular_beds, 0);

    document.getElementById("totalHospitals").textContent = totalHospitals;
    document.getElementById("totalICUBeds").textContent = totalICUBeds;
    document.getElementById("totalRegularBeds").textContent = totalRegularBeds;
  }

  /**
   * Starts a periodic auto-refresh of hospital data.
   */
  startAutoRefresh() {
    // Refresh every 60 seconds (60000 milliseconds)
    setInterval(() => {
      this.fetchAndRenderAll();
      console.log('Auto-refreshing hospital data...');
    }, 60000);
  }

  /**
   * Generates the HTML string for a single hospital item in the list.
   * @param {Object} hospital - The hospital data object.
   * @returns {string} The HTML string for the hospital item.
   */
  getHospitalHTML(hospital) {
    const date = new Date(hospital.timestamp);
    const timestamp = isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
    const cleanPhoneNumber = hospital.contact_info ? hospital.contact_info.replace(/[^0-9+]/g, '') : '';

    // Verification Badge (assuming 'verified' and 'lastVerified' fields exist)
    const verifiedBadge = hospital.verified ?
      `<div class="verified-badge" title="Verified ${hospital.lastVerified ? new Date(hospital.lastVerified).toLocaleDateString() : 'Date N/A'}">
           <i class="fas fa-check-circle"></i> Verified
        </div>` :
      '';

    // Emergency Badge (e.g., if ICU beds are critically low)
    const emergencyBadge = hospital.icu_beds < 5 && hospital.icu_beds > 0 ? // Show if less than 5 but not zero
      `<div class="emergency-badge" title="Critical ICU Shortage (Less than 5 beds)">
           <i class="fas fa-exclamation-triangle"></i> Critical ICU
        </div>` :
        (hospital.icu_beds === 0 ? `<div class="emergency-badge no-beds" title="No ICU Beds Available">
        <i class="fas fa-exclamation-circle"></i> No ICU Beds
     </div>` : '');

    return `
        <div class="hospital-item" aria-labelledby="hospital-name-${hospital.id}">
            <div class="hospital-item-content">
                <div class="hospital-header">
                   <div class="hospital-info">
                        <div id="hospital-name-${hospital.id}" class="hospital-name">${this.escapeHtml(hospital.name)}</div>
                        <div class="badges">
                            ${verifiedBadge}
                            ${emergencyBadge}
                        </div>
                        ${hospital.location ? `
                            <a href="#" class="hospital-location-link" data-hospital-id="${hospital.id}" onclick="event.preventDefault()" aria-label="View ${this.escapeHtml(hospital.name)} on map">
                                <i class="fas fa-map-marker-alt"></i>
                                <span>${this.escapeHtml(hospital.location)} (${this.escapeHtml(hospital.region)})</span>
                            </a>` : ''}
                    </div>
                    <div class="hospital-actions">
                      <button class="btn-edit"
                          aria-label="Edit ${this.escapeHtml(hospital.name)} bed availability"
                          data-hospital-id="${hospital.id}">
                          <i class="fas fa-pencil-alt" aria-hidden="true"></i> Edit
                      </button>
                      <button class="btn-danger btn-delete"
                          aria-label="Delete ${this.escapeHtml(hospital.name)} entry"
                          data-hospital-id="${hospital.id}">
                          <i class="fas fa-trash-alt"></i> Delete
                      </button>
                    </div>
                </div>
                <div class="bed-availability">
                    <div class="bed-type icu">
                        <div class="bed-label">ICU Beds</div>
                        <div class="bed-count">${hospital.icu_beds}</div>
                    </div>
                    <div class="bed-type regular">
                        <div class="bed-label">Regular Beds</div>
                        <div class="bed-count">${hospital.regular_beds}</div>
                    </div>
                </div>
                ${hospital.contact_info ? `<div class="hospital-contact"><i class="fas fa-phone"></i><a href="tel:${cleanPhoneNumber}" class="call-link">${this.escapeHtml(hospital.contact_info)}</a></div>` : ''}
                <div class="timestamp"><i class="fas fa-clock"></i> Updated: ${timestamp}</div>
            </div>
        </div>`;
  }

  /**
   * Generates HTML for empty state messages based on filters.
   * @param {boolean} noHospitalsFetched - True if no hospitals were fetched at all.
   * @returns {string} The HTML string for the empty state.
   */
  getEmptyStateHTML(noHospitalsFetched = false) {
    if (noHospitalsFetched) {
      return `<div class="empty-state"><i class="fas fa-info-circle"></i><h3>No hospital data available.</h3><p>Please check the server or add new entries.</p></div>`;
    }
    if (this.searchTerm) return `<div class="empty-state"><i class="fas fa-search-minus"></i><h3>No results for "${this.escapeHtml(this.searchTerm)}"</h3><p>Try a different search or change your filters.</p></div>`;
    if (this.regionFilter) return `<div class="empty-state"><i class="fas fa-hospital-user"></i><h3>No hospitals found in ${this.escapeHtml(this.regionFilter)}</h3><p>Select another region or "All Regions".</p></div>`;
    if (this.bedTypeFilter || this.distanceFilter) return `<div class="empty-state"><i class="fas fa-filter"></i><h3>No hospitals matching current filters.</h3><p>Adjust your bed type or distance filters.</p></div>`;
    return `<div class="empty-state"><i class="fas fa-hospital-user"></i><h3>No hospitals found.</h3><p>No hospitals match the current criteria.</p></div>`;
  }

  /**
   * Escapes HTML characters to prevent XSS.
   * @param {string} text - The text to escape.
   * @returns {string} The escaped HTML string.
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Checks if the user is an admin based on localStorage.
   * @returns {boolean} True if isAdmin is set to "true", false otherwise.
   */
  isAdmin() {
    return localStorage.getItem("isAdmin") === "true";
  }

  /**
   * Adjusts UI elements visibility based on admin status.
   */
  checkAdminStatus() {
    const submissionSection = document.querySelector(".submission-section");
    const logoutButton = document.getElementById("logoutButton");

    if (this.isAdmin()) {
      if (submissionSection) submissionSection.style.display = "block";
      if (logoutButton) logoutButton.style.display = "inline-flex";
    } else {
      if (submissionSection) submissionSection.style.display = "none";
      if (logoutButton) logoutButton.style.display = "none";
    }
  }

  /**
   * Logs out the administrator.
   */
  logoutAdmin() {
    localStorage.removeItem("isAdmin"); // Clear admin status
    // Use the global showNotificationModal from utils.js
    window.showNotificationModal("You have been successfully logged out.", "info");
    // Redirect to index.html after a short delay
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);
  }

  /**
   * Handles admin login by sending credentials to backend.
   * @param {string} password - The password entered by the user.
   */
  async loginAdmin(password) {
    // IMPORTANT: In a real application, send username/password to your backend for authentication.
    // The current server.js has an `authenticateToken` middleware, but no `/admin/login` endpoint.
    // For your presentation, we'll keep a temporary client-side check if a backend login isn't set up.
    // For production, this should call a secure backend login endpoint.

    try {
        // --- REAL API CALL WOULD GO HERE ---
        // const response = await fetch('https://hospital-bed-backend-154014254128.us-central1.run.app/api/admin/login', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ username: 'admin', password: password })
        // });
        // if (!response.ok) {
        //     const errorData = await response.json();
        //     throw new Error(errorData.message || 'Login failed.');
        // }
        // const authResult = await response.json(); // Might contain a JWT token
        // localStorage.setItem("isAdmin", "true"); // Or store token: localStorage.setItem("authToken", authResult.token);
        // window.showNotificationModal("Login successful! Redirecting...", "success");
        // setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
        // --- END REAL API CALL PLACEHOLDER ---

        // TEMPORARY CLIENT-SIDE CHECK FOR DEMO ONLY (REMOVE FOR PRODUCTION)
        const ADMIN_PASSWORD_TEMP_CLIENT_SIDE = "admin123";
        if (password === ADMIN_PASSWORD_TEMP_CLIENT_SIDE) {
            localStorage.setItem("isAdmin", "true");
            window.showNotificationModal("Login successful! Redirecting...", "success");
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
        } else {
            throw new Error("Incorrect password. Please try again.");
        }

    } catch (error) {
        console.error("Login error:", error);
        window.showNotificationModal(`Login failed: ${error.message}`, "error");
    }
  }

} // End of HospitalBedSystem class

// Ensure the HospitalBedSystem instance is available globally for modal functions in utils.js
let hospitalBedSystemInstance;

document.addEventListener("DOMContentLoaded", () => {
  // If not admin and on dashboard page, redirect to home
  if (localStorage.getItem("isAdmin") !== "true" && window.location.pathname.endsWith('dashboard.html')) {
    window.location.href = 'index.html';
  } else {
    // Initialize HospitalBedSystem only on dashboard page
    if (document.querySelector(".dashboard-grid")) {
      hospitalBedSystemInstance = new HospitalBedSystem();
      window.hospitalBedSystem = hospitalBedSystemInstance; // Make it globally accessible
    }
  }

  // --- PUBLIC AVAILABILITY MODAL FUNCTIONS (specific to index.html) ---
  // These need to be in this scope to access `publicMap`, `publicMarkers`, etc.
  let publicMap = null;
  let publicMarkers = new Map();

  // FIX: Define escapeHtml locally for functions in this scope
  function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
  }

  // Function to initialize the public map
  function initializePublicMap() {
    if (publicMap) {
      setTimeout(() => {
        publicMap.invalidateSize(); // Important for map rendering in a modal
      }, 100);
      return;
    }
    const mapElement = document.getElementById('publicMap');
    if (mapElement) {
      publicMap = L.map('publicMap').setView([7.9465, -1.0232], 7); // Center map on Ghana
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
      }).addTo(publicMap);
      setTimeout(() => {
        publicMap.invalidateSize(); // Important for map rendering in a modal
      }, 100);
    }
  }

  // Function to fetch and render hospitals for the public view
  async function fetchAndRenderPublicHospitals() {
    const publicHospitalsList = document.getElementById('publicHospitalsList');
    if (!publicHospitalsList) return;

    publicHospitalsList.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Loading...</h3></div>`;
    try {
      // Use the deployed backend URL for fetching public hospital data
      const response = await fetch('https://hospital-bed-backend-154014254128.us-central1.run.app/api/hospitals');
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const hospitals = await response.json();

      publicMarkers.forEach(marker => marker.remove());
      publicMarkers.clear();

      if (publicMap) {
        const bounds = L.latLngBounds(); // Create bounds to fit all markers
        hospitals.forEach(hospital => {
          if (hospital.name && hospital.id) {
            const coords = getHospitalCoords(hospital.name); // global from utils.js
            if (coords) {
              const marker = L.marker(coords).addTo(publicMap)
                .bindPopup(`<b>${escapeHtml(hospital.name)}</b><br>ICU: ${hospital.icu_beds}, Regular: ${hospital.regular_beds}`);
              publicMarkers.set(hospital.id, marker);
              bounds.extend(coords);
            }
          }
        });
        if (hospitals.length > 0 && bounds.isValid()) { // Only fit bounds if there are hospitals and bounds are valid
          publicMap.flyToBounds(bounds, {
            padding: [50, 50]
          }); // Fit map to all markers
        } else if (publicMap) {
            // If no hospitals, reset view to Ghana or a default.
            publicMap.setView([7.9465, -1.0232], 7);
        }
      }

      if (hospitals.length > 0) {
        publicHospitalsList.innerHTML = hospitals.map(hospital => getPublicHospitalHTML(hospital)).join('');
      } else {
        publicHospitalsList.innerHTML = `<div class="empty-state"><i class="fas fa-info-circle"></i><h3>No hospital data available.</h3></div>`;
      }
    } catch (error) {
      console.error("Error fetching public hospital data:", error);
      publicHospitalsList.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load data.</h3><p>Please try again later.</p></div>`;
    }
  }

  // Function to generate HTML for a public hospital item
  function getPublicHospitalHTML(hospital) {
    const date = new Date(hospital.timestamp);
    const timestamp = isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
    const cleanPhoneNumber = hospital.contact_info ? hospital.contact_info.replace(/[^0-9+]/g, '') : '';

    // Public view only needs basic badges, no edit/delete buttons
    const verifiedBadge = hospital.verified ?
      `<div class="verified-badge" title="Verified ${hospital.lastVerified ? new Date(hospital.lastVerified).toLocaleDateString() : 'Date N/A'}">
           <i class="fas fa-check-circle"></i> Verified
        </div>` :
      '';

    const emergencyBadge = hospital.icu_beds < 5 && hospital.icu_beds > 0 ?
      `<div class="emergency-badge" title="Critical ICU Shortage (Less than 5 beds)">
           <i class="fas fa-exclamation-triangle"></i> Critical ICU
        </div>` :
        (hospital.icu_beds === 0 ? `<div class="emergency-badge no-beds" title="No ICU Beds Available">
        <i class="fas fa-exclamation-circle"></i> No ICU Beds
     </div>` : '');

    return `
        <div class="hospital-item">
            <div class="hospital-item-content">
                <div class="hospital-header">
                    <div class="hospital-info">
                        <div class="hospital-name">${escapeHtml(hospital.name)}</div>
                        <div class="badges">
                            ${verifiedBadge}
                            ${emergencyBadge}
                        </div>
                        ${hospital.location ? `
                        <a href="#" class="hospital-location-link" data-hospital-id="${hospital.id}" onclick="event.preventDefault()" aria-label="View ${escapeHtml(hospital.name)} on map">
                            <i class="fas fa-map-marker-alt"></i>
                            <span>${escapeHtml(hospital.location)} (${escapeHtml(hospital.region)})</span>
                        </a>` : ''}
                    </div>
                </div>
                <div class="bed-availability">
                    <div class="bed-type icu">
                        <div class="bed-label">ICU Beds</div>
                        <div class="bed-count">${hospital.icu_beds}</div>
                    </div>
                    <div class="bed-type regular">
                        <div class="bed-label">Regular Beds</div>
                        <div class="bed-count">${hospital.regular_beds}</div>
                    </div>
                </div>
                ${hospital.contact_info ? `<div class="hospital-contact"><i class="fas fa-phone"></i><a href="tel:${cleanPhoneNumber}" class="call-link">${escapeHtml(hospital.contact_info)}</a></div>` : ''}
                <div class="timestamp"><i class="fas fa-clock"></i> Updated: ${timestamp}</div>
            </div>
        </div>`;
  }

  // Event listener for "View Current Availability" button on index.html
  const openPublicAvailabilityModalBtn = document.getElementById('openPublicAvailabilityModalBtn');
  if (openPublicAvailabilityModalBtn) {
    openPublicAvailabilityModalBtn.addEventListener('click', async () => {
      if (window.hospitalBedSystem) { // Use the initialized instance for modal control
          window.hospitalBedSystem.showModal('publicAvailabilityModal');
      } else { // Fallback for index.html if class not fully initialized (though it should be)
          document.getElementById('publicAvailabilityModal').style.display = 'flex';
          document.getElementById('publicAvailabilityModal').setAttribute('aria-hidden', 'false');
          document.body.classList.add('modal-open');
      }
      initializePublicMap(); // Initialize the public map inside the modal
      await fetchAndRenderPublicHospitals(); // Fetch and display public hospitals
    });
  }

  // Handle clicks on hospital location links within the public modal
  const publicHospitalsList = document.getElementById('publicHospitalsList');
  if (publicHospitalsList) {
      publicHospitalsList.addEventListener('click', (e) => {
          const locationLink = e.target.closest('.hospital-location-link');
          if (!locationLink) return;

          e.preventDefault();
          const hospitalId = parseInt(locationLink.dataset.hospitalId, 10);
          const marker = publicMarkers.get(hospitalId);

          if (marker && publicMap) {
              const latLng = marker.getLatLng();
              publicMap.flyTo(latLng, 15); // Fly to the marker and zoom in
              marker.openPopup(); // Open the marker's popup
          }
      });
  }

  // --- ADMIN LOGIN MODAL FUNCTIONS (specific to index.html) ---
  const openLoginModalBtn = document.getElementById('openLoginModalBtn');
  if (openLoginModalBtn) {
    openLoginModalBtn.addEventListener('click', () => {
      if (window.hospitalBedSystem) { // Use the initialized instance for modal control
          window.hospitalBedSystem.showModal('adminLoginModal');
          const adminPassInput = document.getElementById('adminPassInput');
          if (adminPassInput) adminPassInput.focus(); // Focus the password input
      } else { // Fallback for index.html if class not fully initialized
          document.getElementById('adminLoginModal').style.display = 'flex';
          document.getElementById('adminLoginModal').setAttribute('aria-hidden', 'false');
          document.body.classList.add('modal-open');
      }
    });
  }

  // Global function for admin login verification (called from inline onclick in index.html)
  // This delegates to the HospitalBedSystem instance method
  window.verifyAdminLogin = () => {
    const password = document.getElementById('adminPassInput').value;
    if (window.hospitalBedSystem) {
      window.hospitalBedSystem.loginAdmin(password);
    } else {
      // Fallback for direct testing if class isn't initialized, though not recommended
      console.warn("HospitalBedSystem not initialized, using client-side fallback for admin login.");
      const ADMIN_PASSWORD_TEMP_CLIENT_SIDE = "admin123";
      if (password === ADMIN_PASSWORD_TEMP_CLIENT_SIDE) {
          localStorage.setItem("isAdmin", "true");
          window.showNotificationModal("Login successful! Redirecting...", "success");
          setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
      } else {
          window.showNotificationModal('Incorrect password. Please try again.', 'error');
      }
    }
  };

  // Global function to close admin modal (called from inline onclick in index.html)
  // This delegates to the HospitalBedSystem instance method
  window.closeAdminModal = () => {
    if (window.hospitalBedSystem) {
      window.hospitalBedSystem.closeModal('adminLoginModal');
    } else {
      const modal = document.getElementById('adminLoginModal');
      if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
      }
    }
  };

  // Global function to close public availability modal (called from inline onclick in index.html)
  // This delegates to the HospitalBedSystem instance method
  window.closePublicAvailabilityModal = () => {
    if (window.hospitalBedSystem) {
      window.hospitalBedSystem.closeModal('publicAvailabilityModal');
    } else {
      const modal = document.getElementById('publicAvailabilityModal');
      if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
      }
    }
  };

}); // End of DOMContentLoaded
