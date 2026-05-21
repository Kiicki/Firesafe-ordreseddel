// Cache for loaded forms (to use with index-based functions)
// Use window scope to ensure consistency
if (!window.loadedForms) window.loadedForms = [];
if (!window.loadedServiceForms) window.loadedServiceForms = [];
var preNewFormData = null;

// Pagination cursors for "Load more"
var _savedLastDoc = null, _sentLastDoc = null, _savedHasMore = false, _sentHasMore = false;
var _templateLastDoc = null, _templateHasMore = false;
var _serviceLastDoc = null, _serviceSentLastDoc = null, _serviceHasMore = false, _serviceSentHasMore = false;
var _lastLocalSaveTs = 0;
var _pendingFirestoreOps = window._pendingFirestoreOps || Promise.resolve();
window._pendingFirestoreOps = _pendingFirestoreOps;

document.addEventListener('click', function(e) {
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;

    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;

    var url;
    try {
        url = new URL(href, window.location.href);
    } catch (err) {
        return;
    }

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === window.location.origin) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    window.open(url.href, '_blank', 'noopener,noreferrer');
});

// Bulk select mode state (saved-modal multi-select for bulk export)
var _selectMode = false;
var _selectedSet = new Set();  // indices into active tab's loaded array
var _selectTab = null;         // 'own' | 'service'

function resetPaginationState() {
    _savedLastDoc = null; _sentLastDoc = null;
    _savedHasMore = false; _sentHasMore = false;
    _templateLastDoc = null; _templateHasMore = false;
    _serviceLastDoc = null; _serviceSentLastDoc = null;
    _serviceHasMore = false; _serviceSentHasMore = false;
}

// Refresh data for the currently active view after auth completes
function refreshActiveView() {
    if (!currentUser || !db) return;
    if (document.body.classList.contains('saved-modal-open')) {
        Promise.all([getSavedForms(), getSentForms()]).then(function(results) {
            if (Date.now() - _lastLocalSaveTs < 5000) return;
            var savedResult = results[0], sentResult = results[1];
            _savedLastDoc = savedResult.lastDoc;
            _sentLastDoc = sentResult.lastDoc;
            _savedHasMore = savedResult.hasMore;
            _sentHasMore = sentResult.hasMore;
            safeSetItem(STORAGE_KEY, JSON.stringify(savedResult.forms.slice(0, 50)));
            safeSetItem(ARCHIVE_KEY, JSON.stringify(sentResult.forms.slice(0, 50)));
            window.loadedForms = _mergeAndDedup(
                savedResult.forms.map(function(f) { return Object.assign({}, f, { _isSent: false }); }),
                sentResult.forms.map(function(f) { return Object.assign({}, f, { _isSent: true }); })
            );
            if (document.body.classList.contains('saved-modal-open')) {
                renderSavedFormsList(window.loadedForms, false, _savedHasMore || _sentHasMore);
            }
        }).catch(function(e) { console.error('Refresh saved forms:', e); });
    } else if (document.body.classList.contains('template-modal-open')) {
        getTemplates().then(function(result) {
            _templateLastDoc = result.lastDoc;
            _templateHasMore = result.hasMore;
            window.loadedTemplates = result.forms;
            safeSetItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
        }).catch(function(e) { console.error('Refresh templates:', e); });
    }
}

// Helper: format date with time
function formatDateWithTime(date) {
    if (!date) return '';
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${day}.${month}.${year}, ${hours}:${mins}`;
}

// View system: show one view, hide all others
var _previousViewId = null;
function showView(viewId) {
    var target = document.getElementById(viewId);
    var alreadyActive = target.classList.contains('active');
    if (!alreadyActive) {
        // Track previous view for back navigation
        var current = document.querySelector('.view.active');
        if (current) _previousViewId = current.id;
        document.querySelectorAll('.view').forEach(function(v) {
            v.classList.remove('active');
        });
        target.classList.add('active');
        target.scrollTop = 0;
        window.scrollTo(0, 0);
    }
    // Toolbar-state (i body vs. inni modal-body) håndteres av
    // applyKeyboardLayout via MutationObserver på .view-class-endringer.
    // Når .active flyttes til en annen view, fyrer observeren og apply
    // re-evaluerer modalHost — ingen manuell håndtering trengs her.
}

function closeAllModals() {
    var actionPopup = document.getElementById('action-popup');
    if (actionPopup) actionPopup.classList.remove('active');
    _bilHistoryRendered = false;
    document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'settings-subpage-open', 'service-view-open', 'kappe-view-open', 'calculator-modal-open');
    // Servicebil-inntak/uttak-modus + picker-overlay må også lukkes —
    // ellers blir picker-overlay synlig over hjem/lagrede når brukeren
    // navigerer vekk fra Servicebil Inntak via toolbar (Hjem etc.).
    document.body.classList.remove('servicebil-inntak-mode', 'servicebil-uttak-mode');
    if (document.body.classList.contains('picker-active') && typeof closePickerOverlay === 'function') {
        closePickerOverlay();
    }
    sessionStorage.removeItem('firesafe_settings_page');
    sessionStorage.removeItem('firesafe_form_type');
    sessionStorage.removeItem('firesafe_hent_tab');
    sessionStorage.removeItem('firesafe_defaults_tab');
    sessionStorage.removeItem('firesafe_service_current');
    sessionStorage.removeItem('firesafe_kappe_current');
    sessionStorage.removeItem('firesafe_servicebil_mode');
    showView('view-form');
}

function isModalOpen() {
    return document.body.classList.contains('template-modal-open')
        || document.body.classList.contains('saved-modal-open')
        || document.body.classList.contains('settings-modal-open')
        || document.body.classList.contains('service-view-open')
        || document.body.classList.contains('kappe-view-open')
        || document.body.classList.contains('calculator-modal-open');
}

// Update toolbar button states based on current view
function updateToolbarState() {
    // No toolbar buttons need disabling anymore — save/export are in the form view itself
}

function _buildSavedItemHtml(item, index) {
    var ordrenr = item.ordreseddelNr || '';
    var dato = formatDateWithTime(item.savedAt);
    var isSent = item._isSent;
    var dot = '<span class="status-dot ' + (isSent ? 'sent' : 'saved') + '"></span>';
    var clipBtn = '<button class="saved-item-action-btn clipboard" title="' + t('copy_btn') + '">' + copyIcon + '</button>';
    var dupBtn = '<button class="saved-item-action-btn copy" title="' + t('duplicate_btn') + '">' + duplicateIcon + '</button>';
    var deleteBtn = isSent
        ? '<button class="saved-item-action-btn delete disabled" title="' + t('delete_btn') + '">' + deleteIcon + '</button>'
        : '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>';
    var subtitle = '';
    if (item.prosjektnr || item.prosjektnavn) {
        var parts = [];
        if (item.prosjektnr) parts.push(escapeHtml(item.prosjektnr));
        if (item.prosjektnavn) parts.push(escapeHtml(item.prosjektnavn));
        subtitle = '<div class="saved-item-subtitle">' + parts.join(' <span class="bil-history-sep"></span> ') + '</div>';
    }
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-header">' +
                '<div class="saved-item-row1">' + dot + (escapeHtml(ordrenr) || t('no_name')) + (dato ? '<span class="saved-item-date-inline">' + escapeHtml(dato) + '</span>' : '') + '</div>' +
            '</div>' +
            subtitle +
        '</div>' +
        '<div class="saved-item-buttons">' + clipBtn + dupBtn + deleteBtn + '</div>' +
    '</div>';
}

function renderSavedFormsList(forms, append, hasMore) {
    var listEl = document.getElementById('saved-list');
    // Remove existing "load more" button
    var existingBtn = listEl.querySelector('.load-more-btn');
    if (existingBtn) existingBtn.remove();

    if (!append) {
        if (!forms || forms.length === 0) {
            listEl.innerHTML = '<div class="no-saved">' + t('no_saved_forms') + '</div>';
            return;
        }
        window.loadedForms = forms;
        listEl.innerHTML = forms.map(function(item, i) { return _buildSavedItemHtml(item, i); }).join('');
    } else {
        var startIndex = window.loadedForms.length;
        window.loadedForms = window.loadedForms.concat(forms);
        var html = forms.map(function(item, i) { return _buildSavedItemHtml(item, startIndex + i); }).join('');
        listEl.insertAdjacentHTML('beforeend', html);
    }

    // Attach form data to DOM elements
    listEl.querySelectorAll('.saved-item').forEach(function(el, i) {
        el._formData = window.loadedForms[i];
    });

    // Add "Load more" button if there are more forms
    if (hasMore) {
        listEl.insertAdjacentHTML('beforeend', '<button class="load-more-btn" onclick="loadMoreSavedForms()">' + t('load_more') + '</button>');
    }

    // Hold markerte rader og "Velg alle"-knapp i synk etter re-rendering
    if (_selectMode) {
        listEl.querySelectorAll('.saved-item').forEach(function(el) {
            var idx = parseInt(el.getAttribute('data-index'), 10);
            if (!isNaN(idx) && _selectedSet.has(idx)) el.classList.add('selected');
        });
        updateSelectionUI();
    }
}

async function loadMoreSavedForms() {
    var btn = document.querySelector('#saved-list .load-more-btn');
    if (btn) btn.textContent = '...';
    var newForms = [];
    if (_savedHasMore && _savedLastDoc) {
        var result = await getSavedForms(_savedLastDoc);
        _savedLastDoc = result.lastDoc;
        _savedHasMore = result.hasMore;
        newForms = newForms.concat(result.forms.map(function(f) { return Object.assign({}, f, { _isSent: false }); }));
    }
    if (_sentHasMore && _sentLastDoc) {
        var result2 = await getSentForms(_sentLastDoc);
        _sentLastDoc = result2.lastDoc;
        _sentHasMore = result2.hasMore;
        newForms = newForms.concat(result2.forms.map(function(f) { return Object.assign({}, f, { _isSent: true }); }));
    }
    newForms.sort(function(a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
    renderSavedFormsList(newForms, true, _savedHasMore || _sentHasMore);
}

function showSavedForms() {
    if (isOnFormPage() && hasUnsavedChanges()) {
        showConfirmModal(t('unsaved_warning'), _showSavedFormsDirectly, t('btn_continue'), '#E8501A');
        return;
    }
    _showSavedFormsDirectly();
}

function _mergeAndDedup(saved, sent) {
    // Ved duplikat ordreseddelNr: behold nyeste versjon (basert på savedAt)
    var all = saved.concat(sent);
    var byNr = {};
    for (var i = 0; i < all.length; i++) {
        var nr = all[i].ordreseddelNr;
        if (!byNr[nr] || (all[i].savedAt || '') > (byNr[nr].savedAt || '')) {
            byNr[nr] = all[i];
        }
    }
    var result = [];
    for (var key in byNr) result.push(byNr[key]);
    return result.sort(function(a, b) {
        if (a._isSent !== b._isSent) return a._isSent ? 1 : -1;
        return (b.savedAt || '').localeCompare(a.savedAt || '');
    });
}

function _showSavedFormsDirectly(tab) {
    closeAllModals();
    if (window.location.hash !== '#hent') {
        window.location.hash = 'hent';
    }

    // Nullstill søkefelt hver gang Skjemaer åpnes
    var savedSearch = document.getElementById('saved-search');
    if (savedSearch) savedSearch.value = '';
    var serviceSearch = document.getElementById('service-search');
    if (serviceSearch) serviceSearch.value = '';
    updateSearchClearBtn('saved-search');
    updateSearchClearBtn('service-search');

    // Show cached data immediately
    const cachedSaved = safeParseJSON(STORAGE_KEY, []);
    const cachedSent = safeParseJSON(ARCHIVE_KEY, []);
    const cachedForms = _mergeAndDedup(
        cachedSaved.map(f => ({ ...f, _isSent: false })),
        cachedSent.map(f => ({ ...f, _isSent: true }))
    );
    renderSavedFormsList(cachedForms);

    showView('saved-modal');
    document.body.classList.add('saved-modal-open');
    updateToolbarState();
    document.getElementById('saved-list').scrollTop = 0;

    switchHentTab(tab || 'own');

    // Refresh from Firestore in background
    if (currentUser && db) {
        Promise.all([getSavedForms(), getSentForms()]).then(function([savedResult, sentResult]) {
            // Hopp over Firestore-overskriving rett etter lokal save/markering
            // for å unngå race condition der stale Firestore-data overskriver localStorage
            if (Date.now() - _lastLocalSaveTs < 5000) return;
            _savedLastDoc = savedResult.lastDoc;
            _sentLastDoc = sentResult.lastDoc;
            _savedHasMore = savedResult.hasMore;
            _sentHasMore = sentResult.hasMore;
            safeSetItem(STORAGE_KEY, JSON.stringify(savedResult.forms.slice(0, 50)));
            safeSetItem(ARCHIVE_KEY, JSON.stringify(sentResult.forms.slice(0, 50)));
            window.loadedForms = _mergeAndDedup(
                savedResult.forms.map(f => ({ ...f, _isSent: false })),
                sentResult.forms.map(f => ({ ...f, _isSent: true }))
            );
            // Only update if still on saved-modal
            if (document.body.classList.contains('saved-modal-open')) {
                renderSavedFormsList(window.loadedForms, false, _savedHasMore || _sentHasMore);
            }
        }).catch(function(e) { console.error('Refresh saved forms:', e); });
    }
}

function setFormReadOnly(readOnly) {
    // Disable all form fields
    const fields = document.querySelectorAll('#mobile-form input, #mobile-form textarea, #mobile-form select, #form-container input, #form-container textarea, #form-container select');
    fields.forEach(el => el.disabled = readOnly);

    // Signering-dato er alltid disabled (system-styrt — alltid dagens for ny/draft, bevarer historisk for sendt)
    var sd = document.getElementById('signering-dato');
    var msd = document.getElementById('mobile-signering-dato');
    if (sd) sd.disabled = true;
    if (msd) msd.disabled = true;

    // Disable save button in header
    var headerSaveBtn = document.getElementById('header-save-btn');
    if (headerSaveBtn) headerSaveBtn.disabled = readOnly;

    // Show/hide sent banner
    document.getElementById('sent-banner').style.display = readOnly ? 'block' : 'none';

    // Disable signature editing
    const signaturePreview = document.getElementById('mobile-signature-preview');
    if (signaturePreview) {
        signaturePreview.style.pointerEvents = readOnly ? 'none' : '';
        signaturePreview.style.opacity = readOnly ? '0.6' : '';
    }

    // Disable "add order" button
    const addOrderBtn = document.querySelector('.mobile-add-line-btn');
    if (addOrderBtn) {
        addOrderBtn.disabled = readOnly;
        addOrderBtn.style.opacity = readOnly ? '0.5' : '';
    }

    // Disable all "delete order" buttons
    if (readOnly) {
        document.querySelectorAll('.mobile-order-header-delete').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.pointerEvents = 'none';
        });
    } else {
        document.querySelectorAll('.mobile-order-header-delete').forEach(btn => {
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
        });
        updateOrderDeleteStates();
    }

    // Disable all "add material" buttons
    document.querySelectorAll('.mobile-add-mat-btn').forEach(btn => {
        btn.disabled = readOnly;
        btn.style.opacity = readOnly ? '0.5' : '';
    });

    // Disable clicking on material rows to edit
    document.querySelectorAll('.mobile-material-row').forEach(row => {
        row.style.pointerEvents = readOnly ? 'none' : '';
    });

}

function loadFormDirect(formData) {
    if (!formData) return;
    setFormData(formData);

    // Signering-dato: alltid dagens for draft (system-styrt, ikke editerbart),
    // bevares historisk kun for sendte skjema.
    // Uke: bevares ALLTID slik den ble lagret (representerer når jobben ble
    // utført — ikke når skjemaet sist ble åpnet). Uke settes bare ved
    // oppretting (nytt skjema/duplisering/clearForm) og kan endres manuelt
    // av brukeren før lagring.
    if (!formData._isSent) {
        _setSigneringDatoToday();
    }

    updateFormTypeChip();
    lastSavedData = getFormDataSnapshot();
    const isSent = !!formData._isSent;
    // Show sent banner but keep form editable
    document.getElementById('sent-banner').style.display = isSent ? 'block' : 'none';
    var btnFormSent = document.getElementById('btn-form-sent');
    if (btnFormSent) btnFormSent.style.display = isSent ? 'none' : '';
    sessionStorage.setItem('firesafe_current_sent', isSent ? '1' : '');
    closeModal();
    // Set hash based on form type
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_form_type', 'own');
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('form_title');
    // Skjema skal ALLTID åpnes fra toppen. closeModal() viser #view-form,
    // men `body.saved-modal-open` fjernes først etterpå — så en synkron
    // scroll-reset her treffer mens viewet ennå er display:none og fester
    // seg ikke. Nullstill etter at viewet faktisk er synlig (neste frame).
    _resetFormViewScroll();
}

// Nullstill scroll-posisjon på det aktive form-viewet (scroll-containeren
// er #view-form selv, jf. .container.form-view{overflow-y:auto}).
function _resetFormViewScroll() {
    function doReset() {
        var vf = document.getElementById('view-form');
        if (vf) vf.scrollTop = 0;
        window.scrollTo(0, 0);
    }
    doReset();
    requestAnimationFrame(function() {
        doReset();
        requestAnimationFrame(doReset);
    });
}

async function duplicateFormDirect(form) {
    if (!form) return;

    setFormData(form);
    // Tøm ordrenummer og sett nytt
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    autoFillOrderNumber();

    // Uke og signering-dato er alltid dagens (system-styrt)
    _setUkeToToday();
    _setSigneringDatoToday();

    // Tøm kundens underskrift
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    // Reset bestillinger til 1 tomt ordrekort
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();
    document.getElementById('work-lines').innerHTML = '';

    lastSavedData = null;
    setFormReadOnly(false);
    closeModal();
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_form_type', 'own');
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('form_title');
    _resetFormViewScroll();
    showNotificationModal(t('duplicated_success'), true);
}

function deleteFormDirect(form) {
    if (!form) return;
    const isSent = form._isSent;
    const confirmMsg = isSent ? t('delete_sent_confirm') : t('delete_confirm');

    showConfirmModal(confirmMsg, function() {
        const col = isSent ? 'archive' : 'forms';
        const lsKey = isSent ? ARCHIVE_KEY : STORAGE_KEY;

        // Optimistic removal: update local state + DOM immediately
        removeFromOrderNumberIndex(form.ordreseddelNr);
        var arrIdx = window.loadedForms.findIndex(function(f) { return f.id === form.id; });
        if (arrIdx !== -1) window.loadedForms.splice(arrIdx, 1);
        var lsList = safeParseJSON(lsKey, []);
        var lsIdx = lsList.findIndex(function(f) { return f.id === form.id; });
        if (lsIdx !== -1) { lsList.splice(lsIdx, 1); safeSetItem(lsKey, JSON.stringify(lsList)); }
        // Remove DOM element
        document.querySelectorAll('#saved-list .saved-item').forEach(function(el) {
            if (el._formData && el._formData.id === form.id) el.remove();
        });
        // Show empty message if no items left
        if (window.loadedForms.length === 0) {
            document.getElementById('saved-list').innerHTML = '<div class="no-saved">' + t('no_saved_forms') + '</div>';
        }

        _lastLocalSaveTs = Date.now();

        enqueueUserDocDelete(col, form.id, 'Delete');
    });
}

function closeModal() {
    showView('view-form');
    document.body.classList.remove('saved-modal-open');
    updateToolbarState();
    document.getElementById('saved-search').value = '';
    var serviceSearch = document.getElementById('service-search');
    if (serviceSearch) serviceSearch.value = '';
    updateSearchClearBtn('saved-search');
    updateSearchClearBtn('service-search');
    // Reset to own tab
    switchHentTab('own');
    sessionStorage.removeItem('firesafe_hent_tab');
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function switchHentTab(tab) {
    if (_selectMode) toggleSelectMode();
    // Migrer 'service' (gammel fane som er fjernet) til 'servicebil'
    if (tab === 'service') tab = 'servicebil';
    sessionStorage.setItem('firesafe_hent_tab', tab);
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const serviceList = document.getElementById('service-list');
    const kappeList = document.getElementById('kappe-list');
    const bilList = document.getElementById('bil-history-list');
    const ownSearch = document.getElementById('own-search-wrap');
    const serviceSearch = document.getElementById('service-search-wrap');
    const kappeSearch = document.getElementById('kappe-search-wrap');

    savedList.style.display = 'none';
    if (serviceList) serviceList.style.display = 'none';
    if (kappeList) kappeList.style.display = 'none';
    if (bilList) bilList.style.display = 'none';
    ownSearch.style.display = 'none';
    if (serviceSearch) serviceSearch.style.display = 'none';
    if (kappeSearch) kappeSearch.style.display = 'none';

    if (tab === 'own') {
        tabs[0].classList.add('active');
        savedList.style.display = '';
        ownSearch.style.display = '';
        savedList.scrollTop = 0;
    } else if (tab === 'servicebil') {
        // Kombinert visning: pafylling (INNTAK) + sendte service-skjemaer (UTTAK)
        if (tabs[1]) tabs[1].classList.add('active');
        if (bilList) { bilList.style.display = ''; bilList.scrollTop = 0; }
        renderBilHistory();
        _bilHistoryRendered = true;
        // Refresh uttak-data fra Firebase i bakgrunnen og re-render
        if (currentUser && db && typeof getServiceForms === 'function' && typeof getServiceSentForms === 'function') {
            Promise.all([getServiceForms(), getServiceSentForms()]).then(function(results) {
                if (Date.now() - _lastLocalSaveTs < 5000) return;
                safeSetItem(SERVICE_STORAGE_KEY, JSON.stringify((results[0].forms || []).slice(0, 50)));
                safeSetItem(SERVICE_ARCHIVE_KEY, JSON.stringify((results[1].forms || []).slice(0, 50)));
                if (document.body.classList.contains('saved-modal-open')) renderBilHistory();
            }).catch(function() {});
        }
    } else if (tab === 'kappe') {
        if (tabs[2]) tabs[2].classList.add('active');
        if (kappeList) { kappeList.style.display = ''; kappeList.scrollTop = 0; }
        if (kappeSearch) kappeSearch.style.display = '';
        loadKappeTab();
    }
    // Tab-switch endrer modal-body display via inline-style. MutationObserveren
    // i tastatur-handleren overvåker class, ikke style — så vi må eksplisitt
    // trigge applyKeyboardLayout for å re-evaluere hvilken modal-body toolbar
    // skal være i. Uten dette ville toolbar bli stuck i forrige aktive modal-body.
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}

function closeActionPopup(e) {
    if (e && e.target !== document.getElementById('action-popup')) return;
    document.getElementById('action-popup').classList.remove('active');
}

// ─── Preview overlay ────────────────────────────────────────────────────────

function updatePreviewHeaderState(hasSig) {
    var closeBtn = document.querySelector('.preview-close-btn');
    var signBtn = document.querySelector('.preview-sign-btn');
    if (hasSig) {
        closeBtn.textContent = t('btn_done');
        closeBtn.classList.add('done');
        signBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> ' + t('btn_signed');
        signBtn.classList.add('signed');
    } else {
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ' + t('btn_close');
        closeBtn.classList.remove('done');
        signBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> ' + t('btn_sign');
        signBtn.classList.remove('signed');
    }
}

// Pinch-to-zoom for preview overlay (mobile only)
function initPreviewPinchZoom(scrollEl, fcEl, baseScale) {
    var pinchStartDist = 0;
    var scaleAtPinchStart = baseScale;
    var isPinching = false;

    function getTouchDist(e) {
        var t = e.touches;
        var dx = t[0].clientX - t[1].clientX;
        var dy = t[0].clientY - t[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e) {
        if (e.touches.length === 2) {
            isPinching = true;
            pinchStartDist = getTouchDist(e);
            scaleAtPinchStart = window._previewCurrentScale || baseScale;
            e.preventDefault();
        }
    }

    function onTouchMove(e) {
        if (!isPinching || e.touches.length !== 2) return;
        e.preventDefault();

        var dist = getTouchDist(e);
        var ratio = dist / pinchStartDist;
        var newScale = Math.min(Math.max(scaleAtPinchStart * ratio, baseScale), 2);
        var oldScale = window._previewCurrentScale || baseScale;

        // Pinch midpoint relative to scroll container viewport
        var rect = scrollEl.getBoundingClientRect();
        var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

        // Save scroll position BEFORE layout changes
        var oldSL = scrollEl.scrollLeft;
        var oldST = scrollEl.scrollTop;

        // Enable horizontal scroll BEFORE changing scale (so scroll range is available)
        if (newScale > baseScale) {
            scrollEl.style.overflowX = 'auto';
        } else {
            scrollEl.style.overflowX = 'hidden';
        }

        // Apply new scale and margins
        window._previewCurrentScale = newScale;
        fcEl.style.transform = 'scale(' + newScale + ')';
        fcEl.style.marginBottom = (-(fcEl.offsetHeight * (1 - newScale))) + 'px';
        fcEl.style.marginRight = (-(fcEl.offsetWidth * (1 - newScale))) + 'px';

        // Force layout reflow so new scroll dimensions are available
        void scrollEl.scrollWidth;

        // Adjust scroll so pinch midpoint stays under fingers
        scrollEl.scrollLeft = (oldSL + midX) * newScale / oldScale - midX;
        scrollEl.scrollTop = (oldST + midY) * newScale / oldScale - midY;
    }

    function onTouchEnd(e) {
        if (e.touches.length < 2) {
            isPinching = false;
        }
    }

    scrollEl.addEventListener('touchstart', onTouchStart, { passive: false });
    scrollEl.addEventListener('touchmove', onTouchMove, { passive: false });
    scrollEl.addEventListener('touchend', onTouchEnd);

    // Store references for cleanup
    window._previewPinchHandlers = {
        el: scrollEl,
        start: onTouchStart,
        move: onTouchMove,
        end: onTouchEnd
    };
}

function cleanupPreviewPinchZoom() {
    var h = window._previewPinchHandlers;
    if (h) {
        h.el.removeEventListener('touchstart', h.start);
        h.el.removeEventListener('touchmove', h.move);
        h.el.removeEventListener('touchend', h.end);
        h.el.style.overflowX = 'hidden';
        window._previewPinchHandlers = null;
    }
    window._previewBaseScale = null;
    window._previewCurrentScale = null;
}

function navigateBack() {
    var current = document.querySelector('.view.active');
    var currentId = current ? current.id : '';
    var prev = _previousViewId;

    // From form view: check unsaved changes, then go to previous
    if (currentId === 'view-form') {
        var target = (prev === 'saved-modal') ? showSavedForms : showTemplateModal;
        if (isOnFormPage() && hasUnsavedChanges()) {
            showConfirmModal(t('unsaved_warning'), target, t('btn_continue'), '#E8501A');
        } else {
            target();
        }
        return;
    }
    // From service view: honor previous view, then go back
    if (currentId === 'service-view') {
        var target = (prev === 'saved-modal')
            ? function() { closeServiceView(); showSavedForms(); }
            : function() { closeServiceView(); showTemplateModal(); };
        if (isOnFormPage() && hasUnsavedChanges()) {
            showConfirmModal(t('unsaved_warning'), target, t('btn_continue'), '#E8501A');
        } else {
            target();
        }
        return;
    }
    // From kappe view: honor previous view, then go back (samme mønster som service)
    if (currentId === 'kappe-view') {
        var target = (prev === 'saved-modal')
            ? function() { closeKappeView(); showSavedForms(); }
            : function() { closeKappeView(); showTemplateModal(); };
        if (isOnFormPage() && hasUnsavedChanges()) {
            showConfirmModal(t('unsaved_warning'), target, t('btn_continue'), '#E8501A');
        } else {
            target();
        }
        return;
    }
    // From Skjemaer: go back to home. closeModal() is reserved for loading a
    // saved form into the order form.
    if (currentId === 'saved-modal') {
        if (_selectMode) toggleSelectMode();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        showTemplateModal();
        return;
    }
    // From Innstillinger: close and go to form
    if (currentId === 'settings-modal') {
        closeSettingsModal();
        return;
    }
    // From Calculator: if on a calc page, go back to menu; otherwise go home
    if (currentId === 'calculator-modal') {
        var activePage = document.querySelector('.calc-page[style=""]') || document.querySelector('.calc-page:not([style*="none"])');
        if (activePage && activePage.style.display !== 'none') {
            // Go back to calculator menu
            document.querySelectorAll('.calc-page').forEach(function(p) { p.style.display = 'none'; });
            document.querySelector('.calc-section').style.display = '';
            document.querySelector('#calculator-modal .modal-header span').textContent = t('calc_title');
        } else {
            document.body.classList.remove('calculator-modal-open');
            showTemplateModal();
        }
        return;
    }
    // Fallback: go home
    showTemplateModal();
}

function updatePreviewScale() {
    var overlay = document.getElementById('preview-overlay');
    if (!overlay || !overlay.classList.contains('active')) return;

    var fc = document.getElementById('form-container');
    var scroll = document.getElementById('preview-scroll');
    if (!fc || !scroll) return;

    // Wipe any lingering inline styles from previous sessions
    fc.style.marginLeft = '';
    fc.style.marginRight = '';
    fc.style.marginTop = '';
    fc.style.marginBottom = '';
    fc.style.transform = '';
    fc.style.transformOrigin = '';
    scroll.classList.remove('centered');

    var cs = getComputedStyle(scroll);
    var padLR = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var availWidth = scroll.clientWidth - padLR;
    var formHeight = fc.offsetHeight;
    // PC (≥1400px med mus): cap til 800px for å matche resten av appens bredde.
    // Mobil/nettbrett: full bredde for konsistens med andre views.
    var isDesktop = window.matchMedia('(min-width: 1400px) and (hover: hover) and (pointer: fine)').matches;
    var maxRenderedWidth = isDesktop ? 800 : availWidth;
    var scale = maxRenderedWidth / 800;

    var header = document.querySelector('.preview-overlay-header');
    var renderedWidth = 800 * scale;
    var translateX = Math.max(0, (availWidth - renderedWidth) / 2);
    fc.style.transformOrigin = 'top left';
    fc.style.transform = 'translate(' + translateX + 'px, 0) scale(' + scale + ')';
    fc.style.marginBottom = (-(formHeight * (1 - scale))) + 'px';
    fc.style.marginRight = -(800 - renderedWidth - translateX) + 'px';
    fc.style.marginLeft = '0';
    if (header) {
        header.style.maxWidth = renderedWidth + 'px';
    }

    window._previewBaseScale = scale;
    window._previewCurrentScale = scale;
}

function openPreview() {
    // Sync mobile form data to desktop layout
    syncMobileToOriginal();
    buildDesktopWorkLines();

    // Convert inputs to spans for clean rendering
    window._previewConverted = convertTextareasToDiv();

    var fc = document.getElementById('form-container');

    // Midlertidig fjern disabled for ren visning (identisk med eksport)
    var disabledFields = fc.querySelectorAll('input:disabled, textarea:disabled, select:disabled');
    disabledFields.forEach(function(el) { el.disabled = false; });
    window._previewDisabledFields = disabledFields;
    var scroll = document.getElementById('preview-scroll');

    // Move form-container into preview scroll area
    scroll.appendChild(fc);

    // Show and scale to fit screen
    fc.style.display = 'block';
    fc.style.width = '800px';

    // Activate overlay first so scroll has dimensions
    window._previewSavedScroll = _saveScrollPositions();
    document.getElementById('preview-overlay').classList.add('active');

    // Hide body scroll so form page scrollbar doesn't show behind overlay
    document.body.style.overflow = 'hidden';
    document.body.classList.add('preview-active');

    // Set header state based on whether signature exists
    var hasSig = !!document.getElementById('mobile-kundens-underskrift').value;
    updatePreviewHeaderState(hasSig);

    // Calculate scale after overlay is visible (never scale up beyond 1)
    requestAnimationFrame(function() {
        updatePreviewScale();
        var s = window._previewBaseScale;
        if (s < 1) {
            initPreviewPinchZoom(scroll, fc, s);
        }
    });

    // Recalculate on browser zoom / window resize / device rotation.
    // Wrap i 200ms timeout for orientationchange (lar viewport settle), og rens
    // + re-init pinch-zoom (samme mønster som service/kappe-preview for konsistens).
    window._previewResizeHandler = function() {
        clearTimeout(window._previewOrdreOrientTimer);
        window._previewOrdreOrientTimer = setTimeout(function() {
            updatePreviewScale();
            cleanupPreviewPinchZoom();
            var scrollEl = document.getElementById('preview-scroll');
            var fcEl = document.getElementById('form-container');
            if (!scrollEl || !fcEl) return;
            var baseScale = Math.min(scrollEl.clientWidth / 800, 1);
            if (baseScale < 1) initPreviewPinchZoom(scrollEl, fcEl, baseScale);
        }, 200);
    };
    window.addEventListener('resize', window._previewResizeHandler);
    window.addEventListener('orientationchange', window._previewResizeHandler);
}

function closePreview() {
    // Remove resize/orientation listener (samme handler bundet til begge events)
    if (window._previewResizeHandler) {
        window.removeEventListener('resize', window._previewResizeHandler);
        window.removeEventListener('orientationchange', window._previewResizeHandler);
        window._previewResizeHandler = null;
    }
    if (window._previewOrdreOrientTimer) {
        clearTimeout(window._previewOrdreOrientTimer);
        window._previewOrdreOrientTimer = null;
    }
    if (window._svcPreviewOrientTimer) {
        clearTimeout(window._svcPreviewOrientTimer);
        window._svcPreviewOrientTimer = null;
    }
    if (window._kappePreviewOrientTimer) {
        clearTimeout(window._kappePreviewOrientTimer);
        window._kappePreviewOrientTimer = null;
    }

    cleanupPreviewPinchZoom();
    document.getElementById('preview-overlay').classList.remove('active');

    // Restore body scroll
    document.body.style.overflow = '';
    document.body.classList.remove('preview-active');
    _restoreScrollPositions(window._previewSavedScroll);
    window._previewSavedScroll = null;

    if (window._servicePreviewActive) {
        // Service preview cleanup
        var sc = document.getElementById('service-export-container');
        document.getElementById('service-view').appendChild(sc);
        sc.style.display = 'none';
        sc.style.width = '';
        sc.style.overflow = '';
        sc.style.transform = '';
        sc.style.transformOrigin = '';
        sc.style.margin = '';
        sc.style.marginBottom = '';
        sc.style.marginLeft = '';
        sc.style.marginRight = '';
        window._servicePreviewActive = false;
    } else if (window._kappePreviewActive) {
        var kc = document.getElementById('kappe-export-container');
        document.getElementById('kappe-view').appendChild(kc);
        kc.style.display = 'none';
        kc.style.width = '';
        kc.style.overflow = '';
        kc.style.transform = '';
        kc.style.transformOrigin = '';
        kc.style.margin = '';
        kc.style.marginBottom = '';
        kc.style.marginLeft = '';
        kc.style.marginRight = '';
        window._kappePreviewActive = false;
        // Restore sign button visibility
        var signBtn = document.querySelector('.preview-sign-btn');
        if (signBtn) signBtn.style.display = '';
    } else {
        var fc = document.getElementById('form-container');
        // Move back to original location inside #view-form
        document.getElementById('view-form').appendChild(fc);

        // Restore original styling
        fc.style.display = '';
        fc.style.width = '';
        fc.style.transform = '';
        fc.style.transformOrigin = '';
        fc.style.margin = '';
        fc.style.marginBottom = '';
        fc.style.marginLeft = '';
        fc.style.marginRight = '';
    }

    // Reset header styles
    var header = document.querySelector('.preview-overlay-header');
    if (header) {
        header.style.maxWidth = '';
        header.style.margin = '';
        header.style.height = '';
        header.style.maxWidth = '';
        header.style.margin = '';
    }

    // Gjenopprett disabled-tilstand
    if (window._previewDisabledFields) {
        window._previewDisabledFields.forEach(function(el) { el.disabled = true; });
        window._previewDisabledFields = null;
    }

    // Restore converted elements
    if (window._previewConverted) {
        restoreTextareas(window._previewConverted);
        window._previewConverted = null;
    }
}

function previewSign() {
    if (window._servicePreviewActive) {
        // Service preview: open signature for service
        signatureTarget = 'service';
        openSignatureOverlay();
        window._signedFromServicePreview = true;
    } else {
        // Regular form preview
        openSignatureOverlay();
        window._signedFromPreview = true;
    }
}

function showExportMenu() {
    if (isModalOpen()) return;
    const popup = document.getElementById('action-popup');
    document.getElementById('action-popup-title').textContent = t('export_title');
    const buttonsEl = document.getElementById('action-popup-buttons');
    var isSent = sessionStorage.getItem('firesafe_current_sent') === '1';
    var checkboxHtml = isSent ? '' :
        '<label style="display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;font-size:14px;padding:8px 0">' +
            '<input type="checkbox" id="export-mark-sent" style="width:22px;height:22px;accent-color:#E8501A;flex-shrink:0">' +
            t('export_and_mark_label') +
        '</label>';
    var shareIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    var canShare = !!(navigator.share && navigator.canShare);
    var shareBtnPDF = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doSharePDF(document.getElementById(\'export-mark-sent\')?.checked); closeActionPopup()">' + shareIcon + ' PDF</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PDF</button>';
    var shareBtnPNG = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doSharePNG(document.getElementById(\'export-mark-sent\')?.checked); closeActionPopup()">' + shareIcon + ' PNG</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PNG</button>';
    let html = checkboxHtml +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('export_download') + '</div>' +
        '<div class="confirm-modal-buttons" style="margin-bottom:12px">' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doExportPDF(document.getElementById(\'export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PDF</button>' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doExportPNG(document.getElementById(\'export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PNG</button>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('btn_share') + '</div>' +
        '<div class="confirm-modal-buttons">' +
            shareBtnPDF + shareBtnPNG +
        '</div>';
    buttonsEl.innerHTML = html;
    popup.classList.add('active');
}

var _filterTimeout = null;
var _searchVersion = 0;
var _savedFormsAll = null;
var _templatesAll = null;
var _serviceFormsAll = null;

// Firestore prefix-søk for skjemaer som ikke er lastet inn ennå
async function firestoreSearchForms(rawTerm, collections, field) {
    if (!currentUser || !db || !rawTerm) return [];
    var searchField = field || 'ordreseddelNr';
    var results = await Promise.all(collections.map(function(col) {
        return db.collection('users').doc(currentUser.uid).collection(col.name)
            .where(searchField, '>=', rawTerm)
            .where(searchField, '<=', rawTerm + '\uf8ff')
            .orderBy(searchField)
            .limit(50)
            .get()
            .catch(function() { return { docs: [] }; });
    }));
    var forms = [];
    results.forEach(function(snap, i) {
        snap.docs.forEach(function(d) {
            forms.push(Object.assign({ id: d.id, _isSent: !!collections[i].isSent }, d.data()));
        });
    });
    return forms;
}

function mergeSearchResults(memoryResults, firestoreResults) {
    var ids = {};
    memoryResults.forEach(function(f) { if (f.id) ids[f.id] = true; });
    var merged = memoryResults.slice();
    firestoreResults.forEach(function(f) {
        if (f.id && !ids[f.id]) merged.push(f);
    });
    return merged;
}

function filterList(listId, searchId) {
    clearTimeout(_filterTimeout);
    _filterTimeout = setTimeout(function() {
        var rawTerm = document.getElementById(searchId).value.trim();
        var term = rawTerm.toLowerCase();

        // Invalider eventuelle in-flight Firestore-søk
        ++_searchVersion;

        if (listId === 'saved-list') {
            if (!_savedFormsAll) _savedFormsAll = window.loadedForms ? window.loadedForms.slice() : [];
            if (!term) { var all = _savedFormsAll; _savedFormsAll = null; renderSavedFormsList(all, false, _savedHasMore || _sentHasMore); return; }
            var filtered = _savedFormsAll.filter(function(f) {
                return (f.ordreseddelNr || '').toLowerCase().startsWith(term) ||
                       (f.prosjektnr || '').toLowerCase().startsWith(term) ||
                       (f.prosjektnavn || '').toLowerCase().startsWith(term);
            });
            renderSavedFormsList(filtered);
            // Søk i Firestore etter ulastede skjemaer (på alle tre felter)
            if ((_savedHasMore || _sentHasMore) && currentUser && db) {
                var ver = ++_searchVersion;
                var cols = [
                    { name: 'forms', isSent: false },
                    { name: 'archive', isSent: true }
                ];
                Promise.all([
                    firestoreSearchForms(rawTerm, cols, 'ordreseddelNr'),
                    firestoreSearchForms(rawTerm, cols, 'prosjektnr'),
                    firestoreSearchForms(rawTerm, cols, 'prosjektnavn')
                ]).then(function(all) {
                    if (ver !== _searchVersion) return;
                    var combined = all[0].concat(all[1], all[2]);
                    var merged = mergeSearchResults(filtered, combined);
                    if (merged.length > filtered.length) {
                        renderSavedFormsList(merged);
                    }
                });
            }
        } else if (listId === 'template-picker-list') {
            var cachedAll = safeParseJSON(TEMPLATE_KEY, []).filter(function(t) { return t.active !== false; });
            var pickerListEl = document.getElementById('template-picker-list');
            if (!term) { _renderTemplatePickerList(cachedAll, pickerListEl); return; }
            var filteredPicker = cachedAll.filter(function(f) {
                return (f.prosjektnavn || '').toLowerCase().startsWith(term) ||
                       (f.oppdragsgiver || '').toLowerCase().startsWith(term) ||
                       (f.prosjektnr || '').toLowerCase().startsWith(term);
            });
            _renderTemplatePickerList(filteredPicker, pickerListEl);
        } else if (listId === 'service-list') {
            if (!_serviceFormsAll) _serviceFormsAll = window.loadedServiceForms ? window.loadedServiceForms.slice() : [];
            if (!term) { var all4 = _serviceFormsAll; _serviceFormsAll = null; renderServiceFormsList(all4); return; }
            var filtered4 = _serviceFormsAll.filter(function(f) {
                return (f.montor || '').toLowerCase().indexOf(term) !== -1;
            });
            renderServiceFormsList(filtered4);
        }
    }, 150);
}

function updateSearchClearBtn(inputId) {
    var input = document.getElementById(inputId);
    var btn = document.getElementById(inputId + '-clear');
    if (!input || !btn) return;
    btn.classList.toggle('visible', !!input.value);
}

function clearSearchInput(inputId, listId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.value = '';
    updateSearchClearBtn(inputId);
    filterList(listId, inputId);
    input.focus();
}

function markCurrentFormAsSent() {
    try {
        var data = getFormData();
        var formsCollection = 'forms';
        var archiveCollection = 'archive';

        // localStorage: legg til i archived, IKKE fjern fra saved (sikkerhetskopi)
        var saved = safeParseJSON(STORAGE_KEY, []);
        var existingIndex = saved.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (existingIndex !== -1) {
            data.id = saved[existingIndex].id;
        } else {
            data.id = Date.now().toString();
        }
        var archived = safeParseJSON(ARCHIVE_KEY, []);
        var archivedExisting = archived.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (archivedExisting !== -1) {
            archived[archivedExisting] = data;
        } else {
            archived.unshift(data);
        }
        safeSetItem(ARCHIVE_KEY, JSON.stringify(archived));
        addToOrderNumberIndex(data.ordreseddelNr);

        // Update UI state
        sessionStorage.setItem('firesafe_current_sent', '1');
        lastSavedData = getFormDataSnapshot();
        document.getElementById('sent-banner').style.display = 'block';
        var btnFormSent = document.getElementById('btn-form-sent');
        if (btnFormSent) btnFormSent.style.display = 'none';
        showNotificationModal(t('marked_as_sent'), true);
        _lastLocalSaveTs = Date.now();
        loadedForms = [];
        _showSavedFormsDirectly();

        enqueueUserDocMove(archiveCollection, formsCollection, data.id, data, 'Mark as sent Firebase');
    } catch (e) {
        console.error('Mark as sent error:', e);
    }
}

// ============================================
// PROSJEKTMALER
// ============================================

if (!window.loadedTemplates) window.loadedTemplates = [];

async function getTemplates(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('templates').orderBy('prosjektnavn').limit(PAGE_SIZE);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return { forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }), lastDoc: snapshot.docs[snapshot.docs.length - 1] || null, hasMore: snapshot.docs.length === PAGE_SIZE };
        } catch (e) {
            console.error('Templates error:', e);
            return { forms: safeParseJSON(TEMPLATE_KEY, []), lastDoc: null, hasMore: false };
        }
    }
    if (auth && !authReady) return { forms: [], lastDoc: null, hasMore: false };
    return { forms: safeParseJSON(TEMPLATE_KEY, []), lastDoc: null, hasMore: false };
}

function _buildTemplateItemHtml(item, index) {
    var row1 = escapeHtml(item.prosjektnavn) || t('no_name');
    var row2 = [item.oppdragsgiver, item.prosjektnr].filter(function(x) { return x; }).map(escapeHtml).join(' \u2022 ');
    var row3 = item.fakturaadresse ? escapeHtml(item.fakturaadresse) : '';
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-row1">' + row1 + '</div>' +
            (row2 ? '<div class="saved-item-row2">' + row2 + '</div>' : '') +
            (row3 ? '<div class="saved-item-row2">' + row3 + '</div>' : '') +
        '</div>' +
    '</div>';
}

var _bilHistoryRendered = false;
function showTemplateModal() {
    closeAllModals();
    history.replaceState(null, '', window.location.pathname);

    showView('template-modal');
    document.body.classList.add('template-modal-open');
    updateToolbarState();
}

function autoFillOrderNumber() {
    const nextNr = getNextOrderNumber();
    if (nextNr !== null) {
        document.getElementById('ordreseddel-nr').value = nextNr;
        document.getElementById('mobile-ordreseddel-nr').value = nextNr;
    }
}

function closeTemplateModal() {
    clearForm();
    preNewFormData = null;
    setFormReadOnly(false);
    autoFillOrderNumber();
    autoFillDefaults();

    showView('view-form');
    document.body.classList.remove('template-modal-open');
    updateToolbarState();
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_form_type', 'own');
    document.getElementById('form-header-title').textContent = t('form_title');
    updateOrderDeleteStates();
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    lastSavedData = getFormDataSnapshot();

    // Scroll to top after all content is set
    requestAnimationFrame(function() {
        document.getElementById('view-form').scrollTop = 0;
        window.scrollTo(0, 0);
    });
}


// ============================================
// ORDRESEDDELNUMMER INNSTILLINGER
// ============================================

// In-memory ranges for settings modal editing
let settingsRanges = [];
let settingsGivenAway = [];

async function getOrderNrSettings() {
    let data = null;
    let fromFirebase = false;
    if (currentUser && db) {
        try {
            const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').get();
            if (doc.exists) { data = doc.data(); fromFirebase = true; }
        } catch (e) {
            console.error('Settings error:', e);
        }
    }
    if (!data) {
        const stored = localStorage.getItem(SETTINGS_KEY);
        data = stored ? JSON.parse(stored) : null;
    }
    // Backward compat: convert old {nrStart, nrEnd} to {ranges}
    if (data && !data.ranges && data.nrStart != null) {
        data = { ranges: [{ start: data.nrStart, end: data.nrEnd }] };
    }
    if (data && !data.givenAway) data.givenAway = [];
    // Hold localStorage i synk med Firebase
    if (fromFirebase && data) safeSetItem(SETTINGS_KEY, JSON.stringify(data));
    return data;
}

async function syncSettingsToLocal() {
    if (!db || !currentUser) return;
    try {
        const doc = await db.collection('users').doc(currentUser.uid)
            .collection('settings').doc('ordrenr').get();
        if (doc.exists) {
            safeSetItem(SETTINGS_KEY, JSON.stringify(doc.data()));
        }
    } catch (e) { /* localStorage-cache brukes som fallback */ }
}

function buildOrderNrSettings() {
    return { ranges: settingsRanges.slice(), givenAway: settingsGivenAway.slice() };
}

function getSettingsPageTitle(page) {
    const titles = {
        'min-info': t('settings_min_info'),
        'form-ordreseddel': t('form_title'),
        'form-service': t('tab_service'),
        'form-kappe': t('kappe_title'),
        templates: t('settings_templates_and_addresses'),
        materials: t('settings_materials')
    };
    return titles[page] || '';
}


function showSettingsModal() {
    if (isOnFormPage() && hasUnsavedChanges()) {
        showConfirmModal(t('unsaved_warning'), _showSettingsDirectly, t('btn_continue'), '#E8501A');
        return;
    }
    _showSettingsDirectly();
}

function _showSettingsDirectly() {
    closeAllModals();
    window.location.hash = 'settings';
    showSettingsMenu();
    showView('settings-modal');
    document.body.classList.add('settings-modal-open');
    updateToolbarState();
}

function openLanguagePopup() {
    // Oppdater haker basert på currentLang
    var checkNo = document.getElementById('lang-check-no');
    var checkEn = document.getElementById('lang-check-en');
    if (checkNo) checkNo.textContent = currentLang === 'no' ? '✓' : '';
    if (checkEn) checkEn.textContent = currentLang === 'en' ? '✓' : '';
    document.getElementById('language-popup').classList.add('active');
}

function closeLanguagePopup() {
    document.getElementById('language-popup').classList.remove('active');
}

function closeSettingsModal() {
    showView('view-form');
    document.body.classList.remove('settings-modal-open');
    updateToolbarState();
    showSettingsMenu();
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function showSettingsMenu() {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-menu').style.display = 'block';
    document.getElementById('settings-header-title').textContent = t('settings_title');
    document.body.classList.remove('settings-subpage-open');
    const header = document.getElementById('settings-header');
    const existingBack = header.querySelector('.settings-back-btn');
    if (existingBack) existingBack.remove();
    history.replaceState(null, '', '#settings');
    sessionStorage.removeItem('firesafe_settings_page');
    sessionStorage.removeItem('firesafe_settings_title');
    sessionStorage.removeItem('firesafe_defaults_tab');
}

function showSettingsPage(page) {
    // Backward-compat: ordrenr og plans er nå innebygde collapsibles på Ordreseddel-siden
    if (page === 'ordrenr' || page === 'plans') page = 'form-ordreseddel';
    var pageEl2 = document.getElementById('settings-page-' + page);
    if (!pageEl2) {
        showSettingsMenu();
        return;
    }
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    pageEl2.style.display = pageEl2.classList.contains('settings-page-flex') ? 'flex' : 'block';
    document.getElementById('settings-header-title').textContent = getSettingsPageTitle(page);
    document.body.classList.add('settings-subpage-open');
    history.pushState(null, '', '#settings/' + page);
    sessionStorage.setItem('firesafe_settings_page', page);
    sessionStorage.setItem('firesafe_settings_title', getSettingsPageTitle(page));

    const header = document.getElementById('settings-header');
    if (!header.querySelector('.settings-back-btn')) {
        const backBtn = document.createElement('button');
        backBtn.className = 'settings-back-btn';
        backBtn.innerHTML = '&lsaquo;';
        backBtn.onclick = showSettingsMenu;
        header.insertBefore(backBtn, header.firstChild);
    }

    // Read-only styling is page-level, while the dispatch below loads data.
    var pageEl = document.getElementById('settings-page-' + page);
    if (!isAdmin && (page === 'materials' || page === 'form-ordreseddel')) {
        pageEl.classList.add('settings-readonly');
    } else {
        pageEl.classList.remove('settings-readonly');
    }

    if (page === 'min-info') {
        _loadMinInfoSettings();
    } else if (page === 'form-ordreseddel') {
        _loadMinInfoSettings();
        // Obligatoriske felt
        cachedRequiredSettings = _getCachedRequiredSettings();
        renderRequiredSettingsItems('save');
        getRequiredSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open')) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('save');
            }
        });
        // Ordreseddelnummer (innebygd som collapsible)
        document.getElementById('settings-new-start').value = '';
        document.getElementById('settings-new-end').value = '';
        document.getElementById('settings-give-start').value = '';
        document.getElementById('settings-give-end').value = '';
        var cachedOrdrenr2 = _getCachedOrderNrSettings();
        if (cachedOrdrenr2) _applyOrderNrSettings(cachedOrdrenr2);
        getOrderNrSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open'))
                _applyOrderNrSettings(settings);
        });
        // Plan / Etasjer (innebygd som collapsible)
        var storedPlans2 = localStorage.getItem(PLANS_KEY);
        settingsPlans = storedPlans2 ? sortPlans(JSON.parse(storedPlans2)) : [];
        document.getElementById('settings-new-plan').value = '';
        renderPlanSettingsItems();
        getPlanSettings().then(function(plans) {
            if (!document.body.classList.contains('settings-modal-open')) return;
            settingsPlans = sortPlans(plans || []);
            renderPlanSettingsItems();
        });
    } else if (page === 'form-service') {
        cachedRequiredSettings = _getCachedRequiredSettings();
        renderRequiredSettingsItems('service');
        getRequiredSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open')) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('service');
            }
        });
        _loadServiceDefaults();
    } else if (page === 'form-kappe') {
        cachedRequiredSettings = _getCachedRequiredSettings();
        renderRequiredSettingsItems('kappe');
        getRequiredSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open')) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('kappe');
            }
        });
        var newBrandEl = document.getElementById('settings-new-kappe-brand');
        var newKappeTypeEl = document.getElementById('settings-new-kappe-type');
        var newKappeTypeBtn = document.getElementById('settings-new-kappe-type-btn');
        var newDimEl = document.getElementById('settings-new-kappe-dim');
        var newKappeUnitsEl = document.getElementById('settings-new-kappe-units');
        if (newBrandEl) newBrandEl.value = '';
        if (newKappeTypeEl) newKappeTypeEl.value = 'isolasjon';
        if (newKappeTypeBtn) {
            newKappeTypeBtn.dataset.value = 'isolasjon';
            newKappeTypeBtn.textContent = t('kappe_product_type_isolasjon');
            newKappeTypeBtn.setAttribute('data-i18n', 'kappe_product_type_isolasjon');
        }
        if (newDimEl) newDimEl.value = '';
        if (newKappeUnitsEl) newKappeUnitsEl.value = '';
        updateKappeNewProductUnitPlaceholder();
        renderKappeProductSettings();
        _loadKappeKerfSetting();
        _loadKappePlateSetting();
        renderKappePlateSettings();
    } else if (page === 'templates') {
        _renderSettingsTemplateListFromData(safeParseJSON(TEMPLATE_KEY, []));
        cachedRequiredSettings = _getCachedRequiredSettings();
        renderRequiredSettingsItems('template');
        renderSettingsTemplateList().then(function() {
            if (!document.body.classList.contains('settings-modal-open')) return;
            getRequiredSettings().then(function(settings) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('template');
            });
        });
        _loadLagerInline();
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('settings').doc('lager').get().then(function(doc) {
                if (!doc.exists) return;
                _saveLagerLocalOnly(doc.data());
                if (document.body.classList.contains('settings-modal-open')) _loadLagerInline();
            }).catch(function() {});
        }
    } else if (page === 'materials') {
        var cachedMat = localStorage.getItem(MATERIALS_KEY);
        var cachedData = normalizeMaterialData(cachedMat ? JSON.parse(cachedMat) : null);
        settingsMaterials = cachedData.materials.slice();
        settingsMaterials.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
        document.getElementById('settings-new-material').value = '';
        document.getElementById('settings-new-material-type').value = 'standard';
        document.getElementById('settings-new-material-variant').value = '';
        updateSettingsUnitFields();
        renderMaterialSettingsItems();
        // Refresh from Firebase
        getMaterialSettings().then(function(data) {
            if (!document.body.classList.contains('settings-modal-open')) return;
            settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
            settingsMaterials.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
            renderMaterialSettingsItems();
        });
    }
}

// Cache-first helpers for settings
function _getCachedOrderNrSettings() {
    var stored = localStorage.getItem(SETTINGS_KEY);
    var data = stored ? JSON.parse(stored) : null;
    if (data && !data.ranges && data.nrStart != null)
        data = { ranges: [{ start: data.nrStart, end: data.nrEnd }] };
    if (data && !data.givenAway) data.givenAway = [];
    return data;
}

function _applyOrderNrSettings(settings) {
    settingsRanges = (settings && settings.ranges) ? settings.ranges.slice() : [];
    settingsGivenAway = (settings && settings.givenAway) ? settings.givenAway.slice() : [];
    renderSettingsRanges();
    renderGivenAwayRanges();
    updateSettingsStatus();
}

function _getCachedRequiredSettings() {
    var stored = localStorage.getItem(REQUIRED_KEY);
    if (stored) {
        try {
            var data = JSON.parse(stored);
            var defaults = getDefaultRequiredSettings();
            return {
                save: Object.assign({}, defaults.save, data.save || {}),
                template: Object.assign({}, defaults.template, data.template || {}),
                service: Object.assign({}, defaults.service, data.service || {}),
                kappe: Object.assign({}, defaults.kappe, data.kappe || {})
            };
        } catch (e) {}
    }
    return getDefaultRequiredSettings();
}

// ============================================
// MATERIALER OG ENHETER INNSTILLINGER
// ============================================

let settingsMaterials = [];

function normalizeAllowedUnits(arr, defaultUnit) {
    if (!arr || arr.length === 0) return [];
    return arr.map(function(u) {
        if (typeof u === 'string') return u;
        // Convert {singular, plural} objects to just the plural string (backward compat)
        return u.plural || u.singular || '';
    }).filter(function(u) { return u; });
}

function normalizeMaterialData(data) {
    if (!data) return { materials: [], units: [] };
    let materials = data.materials || [];
    if (materials.length > 0 && typeof materials[0] === 'string') {
        materials = materials.map(name => ({ name: name, type: 'standard', defaultUnit: '', allowedUnits: [] }));
    } else {
        materials = materials.map(m => {
            // Migrate old types to new system
            var type = m.type || 'standard';
            if (type === 'pipe' || type === 'collar' || type === 'runmeter') type = 'brannpakning';
            if (type === 'dimension') type = 'kabelhylse';
            if (!m.type) {
                if (m.hasRunningMeter || m.isPipe) type = 'brannpakning';
                else if (m.needsSpec || m.hasDimensions) type = 'kabelhylse';
            }
            var allowedUnits = normalizeAllowedUnits(m.allowedUnits, m.defaultUnit || '');
            var defaultUnit = m.defaultUnit || '';
            // Cleanup: orphan defaultUnit (variant ble fjernet, defaultUnit henger igjen).
            // For standard-materialer uten varianter skal defaultUnit være tom.
            if (type === 'standard' && allowedUnits.length === 0 && defaultUnit && defaultUnit !== 'stk') {
                defaultUnit = '';
            }
            return {
                name: m.name,
                type: type,
                defaultUnit: defaultUnit,
                allowedUnits: allowedUnits
            };
        });
    }
    return { materials, units: [] };
}

async function getMaterialSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('settings').doc('materials').get();
            if (doc.exists) {
                const normalized = normalizeMaterialData(doc.data());
                // Hold localStorage i synk med Firebase
                safeSetItem(MATERIALS_KEY, JSON.stringify(normalized));
                return normalized;
            }
        } catch (e) {
            console.error('Materials settings error:', e);
        }
    }
    const stored = localStorage.getItem(MATERIALS_KEY);
    return normalizeMaterialData(stored ? JSON.parse(stored) : null);
}

function saveMaterialSettings() {
    if (!isAdmin) return;
    const data = { materials: settingsMaterials.map(m => ({ name: m.name, type: m.type || 'standard', defaultUnit: m.defaultUnit || '', allowedUnits: m.allowedUnits || [] })), units: [] };
    // localStorage + cache first (optimistic)
    safeSetItem(MATERIALS_KEY, JSON.stringify(data));
    cachedMaterialOptions = data.materials.slice();
    cachedMaterialOptions.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });

    // Firebase in background
    if (currentUser && db) {
        db.collection('settings').doc('materials').set(data)
            .catch(function(e) { console.error('Save materials settings error:', e); });
    }
}

function renderMaterialSettingsItems() {
    const container = document.getElementById('settings-material-items');
    if (settingsMaterials.length === 0) {
        container.innerHTML = '';
        return;
    }
    // Remember which groups were expanded
    const expandedSet = new Set();
    container.querySelectorAll('.settings-material-group.expanded').forEach(el => {
        const name = el.querySelector('.settings-material-name-display');
        if (name) {
            expandedSet.add(name.textContent);
        }
    });
    container.innerHTML = settingsMaterials.map((item, idx) => {
        const unitLocked = item.type !== 'standard';
        const variants = unitLocked ? [] : (item.allowedUnits || []);
        const variantsHtml = variants.map((u, ui) => {
            const label = typeof u === 'string' ? u : (u.plural || u.singular || '');
            const isDefault = label === (item.defaultUnit || '') || (!item.defaultUnit && ui === 0);
            const starIcon = isDefault ? '<span class="settings-material-unit-star" title="Standard">★</span>' : '<span class="settings-material-unit-star empty" title="Sett som standard" onclick="event.stopPropagation();setDefaultVariant(' + idx + ',' + ui + ')">☆</span>';
            const removeBtn = `<button class="settings-material-unit-remove" onclick="event.stopPropagation();removeMaterialUnit(${idx},${ui})">${deleteIcon}</button>`;
            const editBtn = `<button class="settings-material-unit-edit-btn" onclick="event.stopPropagation();editMaterialUnit(${idx},${ui},this)" title="Rediger">${editIcon}</button>`;
            return `<div class="settings-material-unit-item">
                ${starIcon}<span class="settings-material-unit-text">${escapeHtml(label)}</span>${editBtn}${removeBtn}</div>`;
        }).join('');
        const addRow = unitLocked ? '' : `<div class="settings-material-unit-add" onclick="addMaterialUnit(${idx})">+ Legg til variant</div>`;
        const isExpanded = expandedSet.has(item.name);
        const matType = item.type || 'standard';
        const bodyContent = unitLocked ? '' : `${variantsHtml}${addRow}`;
        const variantCount = (!unitLocked && item.allowedUnits) ? item.allowedUnits.length : 0;
        const countBadge = variantCount > 0 ? `<span class="settings-material-variant-count" title="${variantCount} ${variantCount === 1 ? 'variant' : 'varianter'}">${variantCount}</span>` : '';
        return `<div class="settings-material-group${isExpanded ? ' expanded' : ''}">
            <div class="settings-material-header" onclick="toggleMaterialExpand(this)">
                <div class="settings-material-name-wrap">
                    <span class="settings-material-name-display">${escapeHtml(item.name)}</span>
                    ${countBadge}
                </div>
                <button class="settings-material-type-btn" onclick="event.stopPropagation();openMatTypeDropdown(this,${idx})" data-value="${matType}">${t('material_type_' + matType)}</button>
                <button class="settings-material-edit-btn" onclick="event.stopPropagation();editSettingsMaterial(${idx})" title="Rediger navn">${editIcon}</button>
                <button class="settings-delete-btn" onclick="event.stopPropagation();removeSettingsMaterial(${idx})" title="${t('btn_remove')}">${deleteIcon}</button>
                <span class="settings-material-expand">&rsaquo;</span>
            </div>
            <div class="settings-material-body">${bodyContent}</div>
        </div>`;
    }).join('');
}


function toggleMaterialExpand(headerEl) {
    const group = headerEl.closest('.settings-material-group');
    if (group) group.classList.toggle('expanded');
}

function addMaterialUnit(idx) {
    if (!isAdmin) return;
    const mat = settingsMaterials[idx];
    if (!mat.allowedUnits) mat.allowedUnits = [];
    const container = document.getElementById('settings-material-items');
    const group = container.children[idx];
    const addRow = group.querySelector('.settings-material-unit-add');
    if (!addRow) return;

    // Check if already editing
    if (group.querySelector('.settings-material-unit-edit')) return;

    const editRow = document.createElement('div');
    editRow.className = 'settings-material-unit-edit';
    const inputV = document.createElement('input');
    inputV.type = 'text';
    inputV.placeholder = 'Variantnavn';
    inputV.autocapitalize = 'sentences';
    var okBtn = document.createElement('button');
    okBtn.className = 'settings-unit-save settings-unit-save-ok';
    okBtn.textContent = 'OK';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-unit-save settings-unit-cancel';
    cancelBtn.textContent = '✕';
    editRow.appendChild(inputV);
    editRow.appendChild(okBtn);
    editRow.appendChild(cancelBtn);
    addRow.before(editRow);
    addRow.style.display = 'none';
    inputV.focus();
    editRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    function save() {
        const variant = inputV.value.trim();
        if (variant && !mat.allowedUnits.some(u => (typeof u === 'string' ? u : (u.plural || u.singular || '')).toLowerCase() === variant.toLowerCase())) {
            mat.allowedUnits.push(variant);
            saveMaterialSettings();
        }
        renderMaterialSettingsItems();
    }
    function cancel() { renderMaterialSettingsItems(); }
    okBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);
    function handleKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cancel(); }
    }
    inputV.addEventListener('keydown', handleKey);
}

function editMaterialUnit(idx, unitIdx, itemEl) {
    if (!isAdmin) return;
    const mat = settingsMaterials[idx];
    const units = mat.allowedUnits || [];
    const oldUnit = units[unitIdx] || '';
    const oldValue = typeof oldUnit === 'string' ? oldUnit : (oldUnit.plural || oldUnit.singular || '');

    const editRow = document.createElement('div');
    editRow.className = 'settings-material-unit-edit';
    const inputV = document.createElement('input');
    inputV.type = 'text';
    inputV.value = oldValue;
    inputV.placeholder = 'Variantnavn';
    var okBtn = document.createElement('button');
    okBtn.className = 'settings-unit-save settings-unit-save-ok';
    okBtn.textContent = 'OK';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-unit-save settings-unit-cancel';
    cancelBtn.textContent = '✕';
    editRow.appendChild(inputV);
    editRow.appendChild(okBtn);
    editRow.appendChild(cancelBtn);
    itemEl.replaceWith(editRow);
    inputV.focus();
    inputV.select();

    function save() {
        const variant = inputV.value.trim();
        if (variant && variant !== oldValue) {
            if (!mat.allowedUnits) mat.allowedUnits = units.slice();
            mat.allowedUnits[unitIdx] = variant;
            saveMaterialSettings();
        }
        renderMaterialSettingsItems();
    }
    function cancel() { renderMaterialSettingsItems(); }
    okBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);
    function handleKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cancel(); }
    }
    inputV.addEventListener('keydown', handleKey);
}

function setDefaultVariant(idx, unitIdx) {
    if (!isAdmin) return;
    var mat = settingsMaterials[idx];
    if (!mat.allowedUnits) return;
    var variant = mat.allowedUnits[unitIdx];
    var label = typeof variant === 'string' ? variant : (variant.plural || variant.singular || '');
    mat.defaultUnit = label;
    renderMaterialSettingsItems();
    saveMaterialSettings();
}

function removeMaterialUnit(idx, unitIdx) {
    if (!isAdmin) return;
    const mat = settingsMaterials[idx];
    if (!mat.allowedUnits) return;
    var removed = mat.allowedUnits[unitIdx];
    var removedLabel = typeof removed === 'string' ? removed : (removed && (removed.plural || removed.singular) || '');
    mat.allowedUnits.splice(unitIdx, 1);
    if (mat.defaultUnit && mat.defaultUnit === removedLabel) {
        var next = mat.allowedUnits[0];
        mat.defaultUnit = next ? (typeof next === 'string' ? next : (next.plural || next.singular || '')) : '';
    }
    renderMaterialSettingsItems();
    saveMaterialSettings();
}


function toggleSettingsSection(section) {
    const body = document.getElementById('settings-body-' + section);
    const arrow = document.getElementById('settings-arrow-' + section);
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

function updateSettingsUnitFields() {
    var type = document.getElementById('settings-new-material-type').value;
    var variantField = document.getElementById('settings-new-material-variant');
    var variantContainer = variantField ? variantField.closest('.settings-add-unit-fields') : null;
    var fixedUnit = type !== 'standard';
    if (variantContainer) {
        variantContainer.style.display = fixedUnit ? 'none' : '';
    }
    if (fixedUnit && variantField) {
        variantField.value = '';
    }
}

async function addSettingsMaterial() {
    if (!isAdmin) return;
    const input = document.getElementById('settings-new-material');
    const variantInput = document.getElementById('settings-new-material-variant');
    const val = input.value.trim();
    const typeSelect = document.getElementById('settings-new-material-type');
    const type = typeSelect.value;
    const variant = variantInput.value.trim();

    // Validate required fields
    if (!val) {
        input.classList.add('settings-input-error');
        setTimeout(() => {
            input.classList.remove('settings-input-error');
        }, 1500);
        return;
    }
    if (settingsMaterials.some(m => m.name.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_material_exists'));
        return;
    }
    const allowedUnits = [];
    let defaultUnit = 'stk';
    if (type === 'standard' && variant) {
        allowedUnits.push(variant);
    }
    if (type !== 'standard') {
        defaultUnit = 'stk';
    }
    settingsMaterials.push({ name: val, type: type, defaultUnit: defaultUnit, allowedUnits: allowedUnits });
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    input.value = '';
    variantInput.value = '';
    typeSelect.value = 'standard';
    updateSettingsUnitFields();
    renderMaterialSettingsItems();
    await saveMaterialSettings();
    showNotificationModal(t('settings_material_added'), true);
}


function removeSettingsMaterial(idx) {
    if (!isAdmin) return;
    const item = settingsMaterials[idx];
    showConfirmModal(t('settings_material_remove', item.name), async function() {
        settingsMaterials.splice(idx, 1);
        renderMaterialSettingsItems();
        await saveMaterialSettings();
    });
}


function editSettingsMaterial(idx) {
    if (!isAdmin) return;
    const container = document.getElementById('settings-material-items');
    const item = container.children[idx];
    const span = item.querySelector('.settings-material-name-display');
    if (!span) return;
    const oldVal = settingsMaterials[idx].name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = oldVal;
    input.onclick = function(e) { e.stopPropagation(); };
    span.replaceWith(input);
    input.focus();
    input.select();
    let saved = false;
    async function save() {
        if (saved) return;
        saved = true;
        const newVal = input.value.trim();
        if (!newVal || newVal === oldVal) {
            const newSpan = document.createElement('span');
            newSpan.className = 'settings-material-name-display';
            newSpan.textContent = oldVal;
            if (input.parentNode) input.replaceWith(newSpan);
            return;
        }
        if (settingsMaterials.some((m, i) => i !== idx && m.name.toLowerCase() === newVal.toLowerCase())) {
            showNotificationModal(t('settings_material_exists'));
            renderMaterialSettingsItems();
            return;
        }
        settingsMaterials[idx].name = newVal;
        settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
        renderMaterialSettingsItems();
        await saveMaterialSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderMaterialSettingsItems(); }
    });
}

// Felles popup-renderer for type-velger. Brukes både for eksisterende materiale
// (changeMaterialType) og for nytt materiale (oppdaterer skjult select + button-label).
function _renderMatTypePicker(currentValue, onSelect) {
    const existing = document.querySelector('.mat-type-backdrop');
    if (existing) { closeMatTypeDropdown(); return; }

    const types = [
        { value: 'standard', icon: '#', desc: t('material_type_standard_desc'), lm: false },
        { value: 'mansjett', icon: '○', desc: t('material_type_mansjett_desc'), lm: true },
        { value: 'brannpakning', icon: '◎', desc: t('material_type_brannpakning_desc'), lm: true },
        { value: 'kabelhylse', icon: '⬡', desc: t('material_type_kabelhylse_desc'), lm: false }
    ];

    const backdrop = document.createElement('div');
    backdrop.className = 'mat-type-backdrop';
    backdrop.onclick = () => closeMatTypeDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'mat-type-dropdown';

    types.forEach(({ value, icon, desc, lm }) => {
        const isActive = value === currentValue;
        const item = document.createElement('div');
        item.className = 'mat-type-dropdown-item' + (isActive ? ' active' : '');
        const lmBadge = lm ? '<span class="mat-type-lm-badge">→ løpemeter</span>' : '';
        item.innerHTML = `
            <div class="mat-type-icon">${icon}</div>
            <div class="mat-type-text">
                <div class="mat-type-label">${t('material_type_' + value)}${lmBadge}</div>
                <div class="mat-type-desc">${desc.split(' — ')[1] || desc}</div>
            </div>
            <div class="mat-type-check">${isActive ? '✓' : ''}</div>
        `;
        item.onclick = (e) => {
            e.stopPropagation();
            closeMatTypeDropdown();
            if (value !== currentValue) onSelect(value);
        };
        dropdown.appendChild(item);
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(dropdown);
    requestAnimationFrame(() => {
        backdrop.classList.add('visible');
        dropdown.classList.add('visible');
    });
}

function openMatTypeDropdown(btn, idx) {
    _renderMatTypePicker(btn.dataset.value, function(value) {
        changeMaterialType(idx, value);
    });
}

// Åpne picker for nytt-materiale type-knappen. Oppdaterer den skjulte select-en
// og knappens label, og kaller updateSettingsUnitFields for å vise/skjule variant-felt.
function openNewMatTypePicker() {
    var sel = document.getElementById('settings-new-material-type');
    if (!sel) return;
    _renderMatTypePicker(sel.value, function(newValue) {
        sel.value = newValue;
        var btn = document.getElementById('settings-new-material-type-btn');
        if (btn) {
            btn.dataset.value = newValue;
            btn.textContent = t('material_type_' + newValue);
            // Oppdater data-i18n så applyTranslations beholder riktig label ved språk-bytte
            btn.setAttribute('data-i18n', 'material_type_' + newValue);
        }
        if (typeof updateSettingsUnitFields === 'function') updateSettingsUnitFields();
    });
}

function closeMatTypeDropdown() {
    const backdrop = document.querySelector('.mat-type-backdrop');
    const dropdown = document.querySelector('.mat-type-dropdown');
    if (!backdrop) return;
    backdrop.classList.remove('visible');
    if (dropdown) dropdown.classList.remove('visible');
    setTimeout(() => {
        backdrop?.remove();
        dropdown?.remove();
    }, 150);
}

async function changeMaterialType(idx, type) {
    if (!isAdmin) return;
    settingsMaterials[idx].type = type;
    if (type !== 'standard') {
        settingsMaterials[idx].defaultUnit = 'stk';
        settingsMaterials[idx].allowedUnits = [{ singular: 'stk', plural: 'stk' }];
    }
    renderMaterialSettingsItems();
    await saveMaterialSettings();
}



// ============================================
// DROPDOWN FOR MATERIALE OG ENHET
// ============================================

// Cache for dropdown options
let cachedMaterialOptions = null;
let cachedPlanOptions = [];
let settingsPlans = [];

async function getDropdownOptions() {
    // Show cached immediately so picker is never empty
    if (!cachedMaterialOptions) {
        var stored = localStorage.getItem(MATERIALS_KEY);
        if (stored) {
            var cached = normalizeMaterialData(JSON.parse(stored));
            cachedMaterialOptions = (cached && cached.materials) ? cached.materials : [];
            cachedMaterialOptions.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
        }
    }
    // Refresh from Firebase
    const data = await getMaterialSettings();
    cachedMaterialOptions = (data && data.materials) ? data.materials : [];
    cachedMaterialOptions.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    // Cache to localStorage for offline use
    safeSetItem(MATERIALS_KEY, JSON.stringify({ materials: cachedMaterialOptions, units: [] }));
}


// ============================================
// PLAN / ETASJE INNSTILLINGER
// ============================================

async function getPlanSettings() {
    if (currentUser && db) {
        try {
            var doc = await db.collection('settings').doc('plans').get();
            if (doc.exists) {
                var plans = doc.data().plans || [];
                // Hold localStorage i synk med Firebase
                safeSetItem(PLANS_KEY, JSON.stringify(plans));
                return plans;
            }
        } catch (e) { console.error('Plan settings error:', e); }
    }
    var stored = localStorage.getItem(PLANS_KEY);
    return stored ? JSON.parse(stored) : [];
}

function savePlanSettings() {
    if (!isAdmin) return;
    safeSetItem(PLANS_KEY, JSON.stringify(settingsPlans));
    cachedPlanOptions = sortPlans(settingsPlans.slice());
    if (currentUser && db) {
        db.collection('settings').doc('plans').set({ plans: settingsPlans })
            .catch(function(e) { console.error('Save plan settings error:', e); });
    }
}

function renderPlanSettingsItems() {
    var container = document.getElementById('settings-plan-items');
    if (settingsPlans.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = settingsPlans.map(function(name, idx) {
        return _kappeSettingsItemHtml(name, idx, 'editSettingsPlan', 'removeSettingsPlan');
    }).join('');
}

function sortPlans(plans) {
    return plans.sort(function(a, b) {
        var aUp = a.toUpperCase(), bUp = b.toUpperCase();
        var aIsU = aUp.match(/^U(\d*)$/), bIsU = bUp.match(/^U(\d*)$/);
        var aIsNum = aUp.match(/^\d+$/), bIsNum = bUp.match(/^\d+$/);
        // U-etasjer først, synkende (U3 før U1, bare "U" sist blant U-ene)
        if (aIsU && bIsU) {
            var aNum = aIsU[1] === '' ? 0 : parseInt(aIsU[1]);
            var bNum = bIsU[1] === '' ? 0 : parseInt(bIsU[1]);
            return bNum - aNum;
        }
        if (aIsU) return -1;
        if (bIsU) return 1;
        // Tall i stigende rekkefølge
        if (aIsNum && bIsNum) return parseInt(aIsNum[0]) - parseInt(bIsNum[0]);
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        // Resten alfabetisk
        return aUp.localeCompare(bUp, 'no');
    });
}

function addSettingsPlan() {
    if (!isAdmin) return;
    var input = document.getElementById('settings-new-plan');
    var val = input.value.trim().toUpperCase();
    if (!val) return;
    if (settingsPlans.some(function(p) { return p.toUpperCase() === val; })) {
        showNotificationModal(t('settings_plan_exists'));
        return;
    }
    settingsPlans.push(val);
    sortPlans(settingsPlans);
    input.value = '';
    renderPlanSettingsItems();
    savePlanSettings();
    // Scroll to the newly added item
    var idx = settingsPlans.indexOf(val);
    var container = document.getElementById('settings-plan-items');
    if (container.children[idx]) {
        container.children[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function editSettingsPlan(idx) {
    if (!isAdmin) return;
    var cur = settingsPlans[idx];
    if (cur === undefined) return;
    var container = document.getElementById('settings-plan-items');
    var item = container ? container.children[idx] : null;
    var span = item ? item.querySelector('.settings-list-item-name') : null;
    if (!span) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = cur;
    input.autocapitalize = 'characters';
    input.onclick = function(e) { e.stopPropagation(); };
    span.replaceWith(input);
    input.focus();
    input.select();
    var saved = false;

    function save() {
        if (saved) return;
        saved = true;
        var newName = (input.value || '').trim().toUpperCase();
        if (!newName || newName === cur) {
            renderPlanSettingsItems();
            return;
        }
        if (settingsPlans.some(function(p, i) { return i !== idx && p.toUpperCase() === newName; })) {
            showNotificationModal(t('settings_plan_exists'));
            renderPlanSettingsItems();
            return;
        }
        settingsPlans[idx] = newName;
        sortPlans(settingsPlans);
        renderPlanSettingsItems();
        savePlanSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderPlanSettingsItems(); }
    });
}

function removeSettingsPlan(idx) {
    if (!isAdmin) return;
    var name = settingsPlans[idx];
    showConfirmModal(t('settings_plan_remove', name), function() {
        settingsPlans.splice(idx, 1);
        renderPlanSettingsItems();
        savePlanSettings();
    });
}

async function loadPlanOptions() {
    // Show cached immediately
    var stored = localStorage.getItem(PLANS_KEY);
    cachedPlanOptions = stored ? sortPlans(JSON.parse(stored)) : [];
    // Refresh from Firebase
    var plans = await getPlanSettings();
    cachedPlanOptions = sortPlans(plans);
    safeSetItem(PLANS_KEY, JSON.stringify(cachedPlanOptions));
}

// ============================================
// OBLIGATORISKE FELT INNSTILLINGER
// ============================================

function getDefaultRequiredSettings() {
    return {
        save: {
            ordreseddelNr: true,
            dato: true,
            oppdragsgiver: true,
            kundensRef: false,
            fakturaadresse: false,
            prosjektnr: true,
            prosjektnavn: true,
            montor: true,
            avdeling: true,
            sted: true,
            signeringDato: true,
            beskrivelse: true,
            dager: false,
            merknad: false,
            materialer: false,
            signatur: false
        },
        template: {
            prosjektnavn: true,
            prosjektnr: false,
            oppdragsgiver: false,
            kundensRef: false,
            fakturaadresse: false,
            leveringsadresse: false
        },
        service: {
            montor: true,
            dato: true,
            prosjektnr: true,
            prosjektnavn: true,
            materialer: true,
            signatur: false
        },
        kappe: {
            onsketLeveringsdato: false,
            avdeling: false,
            bestiller: false,
            prosjektnr: true,
            prosjektnavn: true,
            pallemerking: false,
            mottaker: false,
            veiadresse: false,
            postnr: false,
            poststed: false,
            kontakt: false,
            tlf: false,
            produkter: true,
            stift: false,
            merknad: false
        }
    };
}

const REQUIRED_FIELD_LABELS = {
    save: [
        { key: 'ordreseddelNr',  labelKey: 'label_ordreseddel_nr' },
        { key: 'dato',           labelKey: 'label_uke' },
        { key: 'oppdragsgiver',  labelKey: 'label_oppdragsgiver' },
        { key: 'kundensRef',     labelKey: 'label_kundens_ref' },
        { key: 'fakturaadresse', labelKey: 'label_fakturaadresse' },
        { key: 'prosjektnr',     labelKey: 'label_prosjektnr' },
        { key: 'prosjektnavn',   labelKey: 'label_prosjektnavn' },
        { key: 'montor',         labelKey: 'label_montor' },
        { key: 'avdeling',       labelKey: 'label_avdeling' },
        { key: 'sted',           labelKey: 'label_sted' },
        { key: 'signeringDato',  labelKey: 'label_dato' },
        { key: 'beskrivelse',    labelKey: 'settings_req_beskrivelse' },
        { key: 'dager',         labelKey: 'order_days' },
        { key: 'merknad',       labelKey: 'order_merknad' },
        { key: 'materialer',    labelKey: 'order_materials_label' },
        { key: 'signatur',       labelKey: 'label_kundens_underskrift' }
    ],
    template: [
        { key: 'prosjektnavn',     labelKey: 'label_prosjektnavn' },
        { key: 'prosjektnr',       labelKey: 'label_prosjektnr' },
        { key: 'oppdragsgiver',    labelKey: 'label_oppdragsgiver' },
        { key: 'kundensRef',       labelKey: 'label_kundens_ref' },
        { key: 'fakturaadresse',   labelKey: 'label_fakturaadresse' },
        { key: 'leveringsadresse', labelKey: 'kappe_section_delivery' }
    ],
    service: [
        { key: 'montor',       labelKey: 'label_montor' },
        { key: 'dato',         labelKey: 'label_dato' },
        { key: 'prosjektnr',   labelKey: 'label_prosjektnr' },
        { key: 'prosjektnavn', labelKey: 'label_prosjektnavn' },
        { key: 'materialer',   labelKey: 'order_materials_label' },
        { key: 'signatur',     labelKey: 'label_kundens_underskrift' }
    ],
    kappe: [
        { key: 'onsketLeveringsdato', labelKey: 'kappe_label_onsket_leveringsdato' },
        { key: 'avdeling',            labelKey: 'label_avdeling' },
        { key: 'bestiller',           labelKey: 'kappe_label_bestiller' },
        { key: 'prosjektnr',          labelKey: 'label_prosjektnr' },
        { key: 'prosjektnavn',        labelKey: 'label_prosjektnavn' },
        { key: 'pallemerking',        labelKey: 'kappe_label_pallemerking' },
        { key: 'mottaker',            labelKey: 'kappe_label_mottaker' },
        { key: 'veiadresse',          labelKey: 'kappe_label_veiadresse' },
        { key: 'postnr',              labelKey: 'placeholder_postnr' },
        { key: 'poststed',            labelKey: 'placeholder_poststed' },
        { key: 'kontakt',             labelKey: 'kappe_label_kontakt' },
        { key: 'tlf',                 labelKey: 'kappe_label_tlf' },
        { key: 'produkter',           labelKey: 'kappe_section_products' },
        { key: 'stift',               labelKey: 'kappe_section_fasteners' },
        { key: 'merknad',             labelKey: 'kappe_col_merknad' }
    ]
};

const REQUIRED_FIELD_GROUPS = {
    kappe: [
        { titleKey: 'kappe_section_project',     keys: ['onsketLeveringsdato', 'avdeling', 'bestiller', 'prosjektnr', 'prosjektnavn', 'pallemerking'] },
        { titleKey: 'kappe_section_delivery',    keys: ['mottaker', 'veiadresse', 'postnr', 'poststed', 'kontakt', 'tlf'] },
        { titleKey: 'settings_kappe_req_content', keys: ['produkter', 'stift', 'merknad'] }
    ]
};

const REQUIRED_FIELD_IDS = {
    ordreseddelNr:  'mobile-ordreseddel-nr',
    dato:           'mobile-dato',
    oppdragsgiver:  'mobile-oppdragsgiver',
    kundensRef:     'mobile-kundens-ref',
    fakturaadresse: 'mobile-fakturaadresse',
    prosjektnr:     'mobile-prosjektnr',
    prosjektnavn:   'mobile-prosjektnavn',
    montor:         'mobile-montor',
    avdeling:       'mobile-avdeling',
    sted:           'mobile-sted',
    signeringDato:  'mobile-signering-dato'
};

async function getRequiredSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('settings').doc('required').get();
            if (doc.exists) {
                const data = doc.data();
                const defaults = getDefaultRequiredSettings();
                const merged = {
                    save: { ...defaults.save, ...(data.save || {}) },
                    template: { ...defaults.template, ...(data.template || {}) },
                    service: { ...defaults.service, ...(data.service || {}) },
                    kappe: { ...defaults.kappe, ...(data.kappe || {}) }
                };
                // Hold localStorage i synk så neste cache-first-render matcher Firebase
                safeSetItem(REQUIRED_KEY, JSON.stringify(merged));
                return merged;
            }
        } catch (e) {
            console.error('Required settings error:', e);
        }
    }
    const stored = localStorage.getItem(REQUIRED_KEY);
    if (stored) {
        try {
            const data = JSON.parse(stored);
            const defaults = getDefaultRequiredSettings();
            return {
                save: { ...defaults.save, ...(data.save || {}) },
                template: { ...defaults.template, ...(data.template || {}) },
                service: { ...defaults.service, ...(data.service || {}) },
                kappe: { ...defaults.kappe, ...(data.kappe || {}) }
            };
        } catch (e) {}
    }
    return getDefaultRequiredSettings();
}

function saveRequiredSettings(data) {
    if (!isAdmin) return;
    // localStorage + cache first (optimistic)
    safeSetItem(REQUIRED_KEY, JSON.stringify(data));
    cachedRequiredSettings = data;
    updateRequiredIndicators();

    // Firebase in background
    if (currentUser && db) {
        db.collection('settings').doc('required').set(data)
            .catch(function(e) { console.error('Save required settings error:', e); });
    }
}

function renderRequiredSettingsItems(section) {
    const container = document.getElementById('settings-fields-' + section + '-items');
    if (!container) return;

    const fields = REQUIRED_FIELD_LABELS[section];
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    const sectionSettings = settings[section] || {};
    const groups = REQUIRED_FIELD_GROUPS[section];

    function renderToggle(field) {
        const isOn = sectionSettings[field.key] !== false;
        return '<div class="settings-toggle-item">' +
            '<span>' + escapeHtml(t(field.labelKey)) + '</span>' +
            '<label class="settings-toggle">' +
            '<input type="checkbox" data-section="' + section + '" data-key="' + field.key + '"' +
            (isOn ? ' checked' : '') + (!isAdmin ? ' disabled' : '') +
            ' onchange="toggleRequiredField(\'' + section + '\', \'' + field.key + '\', this.checked)">' +
            '<span class="settings-toggle-slider"></span>' +
            '</label>' +
            '</div>';
    }

    if (groups) {
        const fieldByKey = {};
        fields.forEach(function(f) { fieldByKey[f.key] = f; });
        container.innerHTML = groups.map(function(group) {
            const items = group.keys.map(function(k) {
                const f = fieldByKey[k];
                return f ? renderToggle(f) : '';
            }).join('');
            return '<div class="required-fields-subsection">' +
                '<div class="required-fields-subtitle">' + escapeHtml(t(group.titleKey)) + '</div>' +
                '<div class="required-fields-subgroup">' + items + '</div>' +
                '</div>';
        }).join('');
    } else {
        container.innerHTML = fields.map(renderToggle).join('');
    }
}

async function toggleRequiredField(section, key, value) {
    if (!isAdmin) return;
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    if (!settings[section]) settings[section] = {};
    settings[section][key] = value;
    await saveRequiredSettings(settings);
    updateRequiredIndicators();
}


// ============================================
// MAL-ADMINISTRASJON I INNSTILLINGER
// ============================================

var _editingTemplateId = null;

function _findSettingsTemplateItem(templateId) {
    var items = document.querySelectorAll('.settings-template-item[data-id]');
    for (var i = 0; i < items.length; i++) {
        if (items[i].getAttribute('data-id') === String(templateId)) return items[i];
    }
    return null;
}

function _renderSettingsTemplateListFromData(templates) {
    var listEl = document.getElementById('settings-template-list');
    if (!listEl) return;

    if (!templates || templates.length === 0) {
        listEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = templates.map(function(tpl) {
        var isActive = tpl.active !== false;
        var name = escapeHtml(tpl.prosjektnavn) || t('no_name');
        var detail = [tpl.oppdragsgiver, tpl.prosjektnr].filter(function(x) { return x; }).map(escapeHtml).join(' \u2022 ');
        var idAttr = escapeHtml(tpl.id);
        var idJs = escapeJsStringAttr(tpl.id);

        var duplicateBtn = isActive
            ? '<button class="settings-template-duplicate-btn" onclick="event.stopPropagation(); duplicateTemplateFromSettings(\'' + idJs + '\')" title="' + t('duplicate_btn') + '">'
            : '<button class="settings-template-duplicate-btn disabled" onclick="event.stopPropagation()" title="' + t('duplicate_btn') + '">';
        var delBtn = isActive
            ? '<button class="settings-template-delete-btn" onclick="event.stopPropagation(); deleteTemplateFromSettings(\'' + idJs + '\')" title="' + t('delete_btn') + '">'
            : '<button class="settings-template-delete-btn disabled" onclick="event.stopPropagation()" title="' + t('delete_btn') + '">';

        return '<div class="settings-template-item' + (isActive ? '' : ' inactive') + '" data-id="' + idAttr + '" onclick="showTemplateEditor(\'' + idJs + '\')">' +
            '<div class="settings-template-item-info">' +
                '<div class="settings-template-item-row1">' + name + '</div>' +
                (detail ? '<div class="settings-template-item-row2">' + detail + '</div>' : '') +
            '</div>' +
            '<div class="settings-template-item-actions">' +
                duplicateBtn + duplicateIcon + '</button>' +
                delBtn +
                    deleteIcon +
                '</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

async function renderSettingsTemplateList() {
    var templates = [];
    if (currentUser && db) {
        try {
            var snapshot = await db.collection('users').doc(currentUser.uid).collection('templates').orderBy('prosjektnavn').limit(100).get();
            templates = snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
        } catch (e) {
            console.error('Load templates for settings:', e);
            templates = safeParseJSON(TEMPLATE_KEY, []);
        }
    } else {
        templates = safeParseJSON(TEMPLATE_KEY, []);
    }
    _renderSettingsTemplateListFromData(templates);
}

var LAGER_FIELDS = ['veiadresse', 'postnr', 'poststed'];
var _lagerInlineInited = false;

function _loadLagerInline() {
    var lager = (typeof getLager === 'function') ? getLager() : null;
    LAGER_FIELDS.forEach(function(f) {
        var el = document.getElementById('lager-inline-' + f);
        if (el) el.value = (lager && lager[f]) || '';
    });
    if (_lagerInlineInited) return;
    _lagerInlineInited = true;
    LAGER_FIELDS.forEach(function(f) {
        var el = document.getElementById('lager-inline-' + f);
        if (!el) return;
        // Dirty-check: lagre kun hvis verdien faktisk endret seg mellom
        // focus og blur. Uten dette skrives det til Firebase ved hver
        // tilfeldig tap-inn-tap-ut, og senere kunne en suksess-toast feilaktig
        // dukke opp uten endring. Site-wide mønster (se mininfo nedenfor).
        var _initialValue = '';
        el.addEventListener('focus', function() { _initialValue = el.value; });
        el.addEventListener('blur', function() {
            if (el.value === _initialValue) return;
            _saveLagerInline();
        });
    });
}

function _saveLagerInline() {
    var data = {};
    LAGER_FIELDS.forEach(function(f) {
        var el = document.getElementById('lager-inline-' + f);
        data[f] = el ? el.value.trim() : '';
    });
    _saveLagerLocalOnly(data);
    enqueueUserDocSet('settings', 'lager', data, 'Save lager');
}

function openProsjektLeveringsadressePicker() {
    var listEl = document.getElementById('prosjekt-lev-picker-list');
    var templates = (window.loadedTemplates || []).filter(function(t) { return t.active !== false && t.leveringsadresse; }).slice();
    if (!templates.length) {
        var local = (safeParseJSON(TEMPLATE_KEY, []) || []).filter(function(t) { return t.active !== false && t.leveringsadresse; });
        templates = local;
    }
    if (!templates.length) {
        listEl.innerHTML = '<div style="padding:16px;color:#999;text-align:center">' + t('no_prosjekt_leveringsadresser') + '</div>';
    } else {
        templates.sort(function(a, b) { return (a.prosjektnavn || '').localeCompare(b.prosjektnavn || '', 'no'); });
        listEl.innerHTML = templates.map(function(item) {
            var id = escapeHtml(item.id);
            var name = escapeHtml(item.prosjektnavn || t('no_name'));
            var addr = escapeHtml(item.leveringsadresse);
            return '<div class="plan-popup-row" onclick="_selectProsjektLeveringsadresse(\'' + id + '\')" style="flex-direction:column;align-items:stretch">' +
                '<span class="plan-popup-name">' + name + '</span>' +
                '<span style="font-size:12px;color:#666;margin-top:2px">' + addr + '</span>' +
            '</div>';
        }).join('');
    }
    document.getElementById('prosjekt-lev-picker-popup').classList.add('active');
}

function closeProsjektLeveringsadressePicker() {
    document.getElementById('prosjekt-lev-picker-popup').classList.remove('active');
}

function _selectProsjektLeveringsadresse(id) {
    closeProsjektLeveringsadressePicker();
    _findTemplateById(id).then(function(tpl) {
        if (!tpl || !tpl.leveringsadresse || typeof parseFakturaadresse !== 'function') return;
        var parsed = parseFakturaadresse(tpl.leveringsadresse);
        var v = document.getElementById('kappe-veiadresse');
        var p = document.getElementById('kappe-postnr');
        var s = document.getElementById('kappe-poststed');
        if (v) v.value = parsed.gate || '';
        if (p) p.value = parsed.postnr || '';
        if (s) s.value = parsed.poststed || '';
        var card = document.getElementById('kappe-delivery-card');
        if (card) {
            var wrap = card.querySelector('.mobile-order-body-wrap');
            if (wrap && !wrap.classList.contains('expanded')) {
                var header = card.querySelector('.mobile-order-header');
                if (header) toggleKappeDeliverySection(header);
            }
        }
    });
}

function useLagerInKappe() {
    var lager = (typeof getLager === 'function') ? getLager() : null;
    if (!lager || !lager.veiadresse) {
        showNotificationModal(t('lager_not_set'));
        return;
    }
    LAGER_FIELDS.forEach(function(f) {
        var el = document.getElementById('kappe-' + f);
        if (el) el.value = lager[f] || '';
    });
    var card = document.getElementById('kappe-delivery-card');
    if (card) {
        var wrap = card.querySelector('.mobile-order-body-wrap');
        if (wrap && !wrap.classList.contains('expanded')) {
            var header = card.querySelector('.mobile-order-header');
            if (header) toggleKappeDeliverySection(header);
        }
    }
}

function showTemplateEditor(templateId) {
    _editingTemplateId = templateId || null;
    var overlay = document.getElementById('template-editor-overlay');
    var titleEl = document.getElementById('template-editor-title');

    // Clear fields
    document.getElementById('tpl-edit-prosjektnavn').value = '';
    document.getElementById('tpl-edit-prosjektnr').value = '';
    document.getElementById('tpl-edit-oppdragsgiver').value = '';
    document.getElementById('tpl-edit-kundensRef').value = '';
    document.getElementById('tpl-edit-fakturaadresse').value = '';
    updateFakturaadresseDisplay('tpl-fakturaadresse-display-text', '');
    document.getElementById('tpl-edit-leveringsadresse').value = '';
    updateFakturaadresseDisplay('tpl-leveringsadresse-display-text', '');

    // Mark required fields
    var reqSettings = cachedRequiredSettings || getDefaultRequiredSettings();
    var templateReqs = reqSettings.template || {};
    var tplFieldMap = {
        prosjektnavn: 'tpl-edit-prosjektnavn',
        prosjektnr: 'tpl-edit-prosjektnr',
        oppdragsgiver: 'tpl-edit-oppdragsgiver',
        kundensRef: 'tpl-edit-kundensRef',
        fakturaadresse: 'tpl-edit-fakturaadresse',
        leveringsadresse: 'tpl-edit-leveringsadresse'
    };
    for (var key in tplFieldMap) {
        var label = document.getElementById(tplFieldMap[key]).closest('label');
        if (templateReqs[key]) label.classList.add('field-required');
        else label.classList.remove('field-required');
    }

    // Vis/skjul deaktiver-knapp (kun i redigeringsmodus)
    var deactBtn = document.getElementById('tpl-deactivate-btn');
    if (deactBtn) deactBtn.style.display = templateId ? '' : 'none';

    if (templateId) {
        titleEl.textContent = t('settings_edit_template');
        // Find template and fill fields + set deactivate button text
        _findTemplateById(templateId).then(function(tpl) {
            if (tpl) {
                document.getElementById('tpl-edit-prosjektnavn').value = tpl.prosjektnavn || '';
                document.getElementById('tpl-edit-prosjektnr').value = tpl.prosjektnr || '';
                document.getElementById('tpl-edit-oppdragsgiver').value = tpl.oppdragsgiver || '';
                document.getElementById('tpl-edit-kundensRef').value = tpl.kundensRef || '';
                document.getElementById('tpl-edit-fakturaadresse').value = tpl.fakturaadresse || '';
                updateFakturaadresseDisplay('tpl-fakturaadresse-display-text', tpl.fakturaadresse || '');
                document.getElementById('tpl-edit-leveringsadresse').value = tpl.leveringsadresse || '';
                updateFakturaadresseDisplay('tpl-leveringsadresse-display-text', tpl.leveringsadresse || '');
                if (deactBtn) {
                    deactBtn.textContent = tpl.active === false ? t('settings_template_activate') : t('settings_template_deactivate');
                }
            }
        });
    } else {
        titleEl.textContent = t('settings_new_template');
    }

    overlay.classList.add('active');
}

function closeTemplateEditor() {
    _editingTemplateId = null;
    document.getElementById('template-editor-overlay').classList.remove('active');
}

async function duplicateTemplateFromSettings(templateId) {
    var tpl = await _findTemplateById(templateId);
    if (!tpl) return;
    showTemplateEditor();
    document.getElementById('tpl-edit-prosjektnavn').value = tpl.prosjektnavn || '';
    document.getElementById('tpl-edit-prosjektnr').value = tpl.prosjektnr || '';
    document.getElementById('tpl-edit-oppdragsgiver').value = tpl.oppdragsgiver || '';
    document.getElementById('tpl-edit-kundensRef').value = tpl.kundensRef || '';
    document.getElementById('tpl-edit-fakturaadresse').value = tpl.fakturaadresse || '';
    updateFakturaadresseDisplay('tpl-fakturaadresse-display-text', tpl.fakturaadresse || '');
    document.getElementById('tpl-edit-leveringsadresse').value = tpl.leveringsadresse || '';
    updateFakturaadresseDisplay('tpl-leveringsadresse-display-text', tpl.leveringsadresse || '');
}

async function toggleActiveFromEditor() {
    if (!_editingTemplateId) return;
    await toggleTemplateActive(_editingTemplateId);
    closeTemplateEditor();
    await renderSettingsTemplateList();
}

async function _findTemplateById(id) {
    // Check in-memory first (instant)
    var inMem = (window.loadedTemplates || []).find(function(t) { return t.id === id; });
    if (inMem) return inMem;
    // Then localStorage
    var templates = safeParseJSON(TEMPLATE_KEY, []);
    var local = templates.find(function(t) { return t.id === id; });
    if (local) return local;
    // Last resort: Firebase
    if (currentUser && db) {
        try {
            var doc = await db.collection('users').doc(currentUser.uid).collection('templates').doc(id).get();
            if (doc.exists) return Object.assign({ id: doc.id }, doc.data());
        } catch (e) {
            console.error('Find template error:', e);
        }
    }
    return null;
}

async function saveTemplateFromEditor() {
    var data = {
        prosjektnavn: document.getElementById('tpl-edit-prosjektnavn').value.trim(),
        prosjektnr: document.getElementById('tpl-edit-prosjektnr').value.trim(),
        oppdragsgiver: document.getElementById('tpl-edit-oppdragsgiver').value.trim(),
        kundensRef: document.getElementById('tpl-edit-kundensRef').value.trim(),
        fakturaadresse: document.getElementById('tpl-edit-fakturaadresse').value.trim(),
        leveringsadresse: document.getElementById('tpl-edit-leveringsadresse').value.trim()
    };
    // Validate required template fields
    var reqSettings = cachedRequiredSettings || getDefaultRequiredSettings();
    var templateReqs = reqSettings.template || {};
    var validationKeys = {
        prosjektnavn: 'validation_prosjektnavn',
        prosjektnr: 'validation_prosjektnr',
        oppdragsgiver: 'validation_oppdragsgiver',
        kundensRef: 'validation_kundens_ref',
        fakturaadresse: 'validation_fakturaadresse',
        leveringsadresse: 'kappe_section_delivery'
    };
    for (var key in validationKeys) {
        if (templateReqs[key] && !data[key]) {
            showNotificationModal(t('required_field', t(validationKeys[key])));
            return;
        }
    }

    // Update localStorage immediately (optimistic)
    var templates = safeParseJSON(TEMPLATE_KEY, []);

    if (_editingTemplateId) {
        // Update existing template in localStorage
        var idx = templates.findIndex(function(t) { return t.id === _editingTemplateId; });
        if (idx !== -1) {
            Object.assign(templates[idx], data);
        }
        safeSetItem(TEMPLATE_KEY, JSON.stringify(templates));
        showNotificationModal(t('template_updated'), true);

        enqueueUserDocSet('templates', _editingTemplateId, data, 'Update template', { merge: true });
    } else {
        // Create new template
        data.createdAt = new Date().toISOString();
        data.createdBy = currentUser ? currentUser.uid : 'local';
        data.active = true;
        data.id = Date.now().toString();

        // Update localStorage immediately
        templates.push(data);
        safeSetItem(TEMPLATE_KEY, JSON.stringify(templates));
        showNotificationModal(t('template_save_success'), true);

        enqueueUserDocSet('templates', data.id, data, 'Create template');
    }

    closeTemplateEditor();
    _renderSettingsTemplateListFromData(templates);
}

async function toggleTemplateActive(templateId) {
    var tpl = await _findTemplateById(templateId);
    if (!tpl) return;

    var newActive = tpl.active === false ? true : false;

    // Update visual state + localStorage immediately (optimistic)
    var itemEl = _findSettingsTemplateItem(templateId);
    if (itemEl) {
        if (newActive) itemEl.classList.remove('inactive');
        else itemEl.classList.add('inactive');
    }
    var templates = safeParseJSON(TEMPLATE_KEY, []);
    var idx = templates.findIndex(function(t) { return t.id === templateId; });
    if (idx !== -1) {
        templates[idx].active = newActive;
        safeSetItem(TEMPLATE_KEY, JSON.stringify(templates));
    }

    enqueueUserDocSet('templates', templateId, { active: newActive }, 'Toggle template', { merge: true });
}

async function deleteTemplateFromSettings(templateId) {
    var tpl = await _findTemplateById(templateId);
    if (!tpl) return;
    showConfirmModal(t('template_delete_confirm'), function() {
        // Optimistic removal: update local state + DOM immediately
        var arrIdx = window.loadedTemplates.findIndex(function(t) { return t.id === templateId; });
        if (arrIdx !== -1) window.loadedTemplates.splice(arrIdx, 1);
        var lsList = safeParseJSON(TEMPLATE_KEY, []);
        var lsIdx = lsList.findIndex(function(t) { return t.id === templateId; });
        if (lsIdx !== -1) { lsList.splice(lsIdx, 1); safeSetItem(TEMPLATE_KEY, JSON.stringify(lsList)); }
        // Remove DOM element
        var el = _findSettingsTemplateItem(templateId);
        if (el) el.remove();
        // Show empty message if no items left
        var listEl = document.getElementById('settings-template-list');
        if (listEl && !listEl.querySelector('.settings-template-item')) {
            listEl.innerHTML = '';
        }

        enqueueUserDocDelete('templates', templateId, 'Delete template');
    });
}

function updateRequiredIndicators() {
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    const saveReqs = settings.save || {};

    // Update text input fields
    for (const [key, inputId] of Object.entries(REQUIRED_FIELD_IDS)) {
        const input = document.getElementById(inputId);
        if (!input) continue;
        const field = input.closest('.mobile-field');
        if (!field) continue;

        if (saveReqs[key]) {
            field.classList.add('field-required');
        } else {
            field.classList.remove('field-required');
        }
    }

    // Order description fields (dynamic order cards)
    document.querySelectorAll('#mobile-orders .mobile-order-desc').forEach(function(desc) {
        const field = desc.closest('.mobile-field');
        if (!field) return;
        if (saveReqs.beskrivelse !== false) {
            field.classList.add('field-required');
        } else {
            field.classList.remove('field-required');
        }
    });

    // Materials and Timer labels in order cards
    document.querySelectorAll('#mobile-orders .mobile-order-card').forEach(function(card) {
        // Materials section — toggle field-required class (CSS adds star via ::after)
        var matSection = card.querySelector('.mobile-order-materials-section');
        if (matSection) {
            matSection.classList.toggle('field-required', !!saveReqs.materialer);
            // Fjern gammel inline span hvis eksisterer (backward compat ved live toggle)
            var oldStar = matSection.querySelector('.required-star');
            if (oldStar) oldStar.remove();
        }
        // Dager & tid (Arbeidstid) field
        var dagTimerDisplay = card.querySelector('.dag-timer-display');
        if (dagTimerDisplay) {
            var dagerField = dagTimerDisplay.closest('.mobile-field');
            if (dagerField) {
                if (saveReqs.dager) {
                    dagerField.classList.add('field-required');
                } else {
                    dagerField.classList.remove('field-required');
                }
            }
        }
        // Merknad field
        var merknadInput = card.querySelector('.mobile-order-merknad');
        if (merknadInput) {
            var merknadField = merknadInput.closest('.mobile-field');
            if (merknadField) {
                if (saveReqs.merknad) {
                    merknadField.classList.add('field-required');
                } else {
                    merknadField.classList.remove('field-required');
                }
            }
        }
    });

    // Signature field
    const sigPreview = document.getElementById('mobile-signature-preview');
    if (sigPreview) {
        const sigField = sigPreview.closest('.mobile-field');
        if (sigField) {
            if (saveReqs.signatur) {
                sigField.classList.add('field-required');
            } else {
                sigField.classList.remove('field-required');
            }
        }
    }

    // Service form required indicators
    const serviceReqs = settings.service || {};

    // Service montør field
    const serviceMontor = document.getElementById('service-montor');
    if (serviceMontor) {
        const serviceMontorField = serviceMontor.closest('.mobile-field');
        if (serviceMontorField) {
            if (serviceReqs.montor !== false) {
                serviceMontorField.classList.add('field-required');
            } else {
                serviceMontorField.classList.remove('field-required');
            }
        }
    }

    // Service signature field
    const serviceSigPreview = document.getElementById('service-signature-preview');
    if (serviceSigPreview) {
        const serviceSigField = serviceSigPreview.closest('.mobile-field');
        if (serviceSigField) {
            if (serviceReqs.signatur) {
                serviceSigField.classList.add('field-required');
            } else {
                serviceSigField.classList.remove('field-required');
            }
        }
    }

    // Service entry card fields (dynamic)
    document.querySelectorAll('#service-entries .service-entry-card').forEach(function(card) {
        var datoField = card.querySelector('.service-entry-dato');
        if (datoField) {
            var f = datoField.closest('.mobile-field');
            if (f) f.classList.toggle('field-required', serviceReqs.dato !== false);
        }
        var pnrField = card.querySelector('.service-entry-prosjektnr');
        if (pnrField) {
            var f = pnrField.closest('.mobile-field');
            if (f) f.classList.toggle('field-required', serviceReqs.prosjektnr !== false);
        }
        var pnavnField = card.querySelector('.service-entry-prosjektnavn');
        if (pnavnField) {
            var f = pnavnField.closest('.mobile-field');
            if (f) f.classList.toggle('field-required', serviceReqs.prosjektnavn !== false);
        }
        // Materials section
        var matSection = card.querySelector('.mobile-order-materials-section');
        if (matSection) {
            matSection.classList.toggle('field-required', serviceReqs.materialer !== false);
        }
    });

    // Kappe form required indicators
    if (document.getElementById('kappe-view')) {
        updateKappeRequiredIndicators();
    }
}

// ============================================
// STANDARDVERDIER (AUTOFYLL)
// ============================================

const DEFAULT_FIELDS = ['montor', 'avdeling', 'sted'];

async function syncDefaultsToLocal() {
    if (!db || !currentUser) return;
    try {
        var doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults').get();
        if (doc.exists) safeSetItem(DEFAULTS_KEY, JSON.stringify(doc.data()));
        var sDoc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults_service').get();
        if (sDoc.exists) safeSetItem(SERVICE_DEFAULTS_KEY, JSON.stringify(sDoc.data()));
        var kDoc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults_kappe').get();
        if (kDoc.exists) safeSetItem(KAPPE_DEFAULTS_KEY, JSON.stringify(kDoc.data()));
        var plateDoc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('plateSize').get();
        if (plateDoc.exists) localStorage.setItem('firesafe_plate_size', JSON.stringify(plateDoc.data()));
        var miDoc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('min_info').get();
        if (miDoc.exists) {
            safeSetItem(MIN_INFO_KEY, JSON.stringify(miDoc.data()));
        } else if (typeof _migrateMinInfo === 'function') {
            // Firebase has no min_info yet — seed from legacy defaults that just synced
            localStorage.removeItem(MIN_INFO_KEY);
            _migrateMinInfo();
        }
    } catch (e) { /* localStorage-cache brukes som fallback */ }
}

function autoFillDefaults(type) {
    var defaults = getMinInfo();
    DEFAULT_FIELDS.forEach(field => {
        if (defaults[field]) {
            if (defaults['autofill_' + field] === false) return;
            var el = document.getElementById(field);
            var mobileEl = document.getElementById('mobile-' + field);
            if (el) el.value = defaults[field];
            if (mobileEl) mobileEl.value = defaults[field];
        }
    });
}

function renderSettingsRanges() {
    const container = document.getElementById('settings-ranges');
    const countEl = document.getElementById('settings-count-ranges');
    if (settingsRanges.length === 0) {
        container.innerHTML = '';
        if (countEl) countEl.textContent = '';
        return;
    }
    container.innerHTML = settingsRanges.map((r, idx) =>
        `<div class="settings-range-item">
            <span>${escapeHtml(String(r.start))} – ${escapeHtml(String(r.end))}</span>
            <button class="settings-delete-btn" onclick="removeSettingsRange(${idx})" title="${t('btn_remove')}">${deleteIcon}</button>
        </div>`
    ).join('');
    if (countEl) {
        let total = 0;
        settingsRanges.forEach(r => { total += r.end - r.start + 1; });
        countEl.textContent = '(' + settingsRanges.length + (settingsRanges.length === 1 ? ' serie, ' : ' serier, ') + total + ' nr)';
    }
}

function addSettingsRange() {
    const startInput = document.getElementById('settings-new-start');
    const endInput = document.getElementById('settings-new-end');
    const start = parseInt(startInput.value);
    const end = parseInt(endInput.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        showNotificationModal(t('settings_range_error'));
        return;
    }
    const overlaps = settingsRanges.some(r => start <= r.end && end >= r.start);
    if (overlaps) {
        showNotificationModal(t('settings_range_overlap'));
        return;
    }
    settingsRanges.push({ start, end });
    startInput.value = '';
    endInput.value = '';
    renderSettingsRanges();
    updateSettingsStatus();
    // Auto-save: localStorage first, Firebase in background
    const settings = buildOrderNrSettings();
    safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_range_added'), true);
    enqueueUserDocSet('settings', 'ordrenr', settings, 'Save range');
}

function removeSettingsRange(idx) {
    const r = settingsRanges[idx];
    showConfirmModal(t('settings_range_remove', r.start, r.end), function() {
        settingsRanges.splice(idx, 1);
        renderSettingsRanges();
        updateSettingsStatus();
        // Auto-save: localStorage first, Firebase in background
        const settings = buildOrderNrSettings();
        safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
        enqueueUserDocSet('settings', 'ordrenr', settings, 'Remove range');
    });
}

function renderGivenAwayRanges() {
    const container = document.getElementById('settings-given-away');
    const countEl = document.getElementById('settings-count-giveaway');
    if (!container) return;
    if (settingsGivenAway.length === 0) {
        container.innerHTML = '';
        if (countEl) countEl.textContent = '';
        return;
    }
    container.innerHTML = settingsGivenAway.map((r, idx) =>
        `<div class="settings-range-item settings-given-item">
            <span>${r.start === r.end ? escapeHtml(String(r.start)) : escapeHtml(String(r.start)) + ' – ' + escapeHtml(String(r.end))}</span>
            <button class="settings-delete-btn" onclick="removeGivenAway(${idx})" title="${t('btn_remove')}">${deleteIcon}</button>
        </div>`
    ).join('');
    if (countEl) {
        let total = 0;
        settingsGivenAway.forEach(r => { total += r.end - r.start + 1; });
        countEl.textContent = '(' + total + ' nr)';
    }
}

function addGivenAwayRange() {
    const startInput = document.getElementById('settings-give-start');
    const endInput = document.getElementById('settings-give-end');
    const start = parseInt(startInput.value);
    const end = endInput.value.trim() === '' ? start : parseInt(endInput.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        showNotificationModal(t('settings_range_error'));
        return;
    }
    // Must be within an existing range
    if (!isNumberInRanges(start, settingsRanges) || !isNumberInRanges(end, settingsRanges)) {
        showNotificationModal(t('settings_give_not_in_range'));
        return;
    }
    // Check overlap with already given-away
    const overlapsGiven = settingsGivenAway.some(r => start <= r.end && end >= r.start);
    if (overlapsGiven) {
        showNotificationModal(t('settings_give_overlap'));
        return;
    }
    // Check if any numbers are already used (saved/sent)
    const usedNumbers = getUsedOrderNumbers();
    for (let n = start; n <= end; n++) {
        if (usedNumbers.has(String(n))) {
            showNotificationModal(t('settings_give_already_used', n));
            return;
        }
    }
    settingsGivenAway.push({ start, end });
    settingsGivenAway.sort((a, b) => a.start - b.start);
    startInput.value = '';
    endInput.value = '';
    renderGivenAwayRanges();
    updateSettingsStatus();
    // Auto-save: localStorage first, Firebase in background
    const settings = buildOrderNrSettings();
    safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_give_added'), true);
    enqueueUserDocSet('settings', 'ordrenr', settings, 'Save give-away');
}

function removeGivenAway(idx) {
    const r = settingsGivenAway[idx];
    const label = r.start === r.end ? String(r.start) : r.start + ' – ' + r.end;
    showConfirmModal(t('settings_give_remove', label), function() {
        settingsGivenAway.splice(idx, 1);
        renderGivenAwayRanges();
        updateSettingsStatus();
        // Auto-save: localStorage first, Firebase in background
        const settings = buildOrderNrSettings();
        safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
        enqueueUserDocSet('settings', 'ordrenr', settings, 'Remove give-away');
    });
}

function getGivenAwayNumbers() {
    const given = new Set();
    settingsGivenAway.forEach(r => {
        for (let n = r.start; n <= r.end; n++) given.add(String(n));
    });
    return given;
}

async function updateSettingsStatus() {
    const statusEl = document.getElementById('settings-status');
    if (settingsRanges.length === 0) {
        statusEl.textContent = '';
        return;
    }

    let total = 0;
    settingsRanges.forEach(r => { total += r.end - r.start + 1; });

    const usedNumbers = getUsedOrderNumbers();
    const givenNumbers = getGivenAwayNumbers();
    let usedCount = 0;
    let givenCount = 0;
    settingsRanges.forEach(r => {
        for (let n = r.start; n <= r.end; n++) {
            if (givenNumbers.has(String(n))) givenCount++;
            else if (usedNumbers.has(String(n))) usedCount++;
        }
    });

    // Merge given into used for "next" calculation
    const allUnavailable = new Set([...usedNumbers, ...givenNumbers]);
    const nextNr = findNextInRanges(settingsRanges, allUnavailable);
    let statusText = t('settings_used', usedCount, total);
    if (givenCount > 0) statusText += ' · ' + t('settings_given_away_count', givenCount);
    statusText += nextNr ? ' · ' + t('settings_next', nextNr) : ' · ' + t('settings_all_used');
    statusEl.textContent = statusText;
}

function getUsedOrderNumbers() {
    return new Set(safeParseJSON(USED_NUMBERS_KEY, []));
}

function findNextInRanges(ranges, usedNumbers) {
    for (const r of ranges) {
        for (let n = r.start; n <= r.end; n++) {
            if (!usedNumbers.has(String(n))) return n;
        }
    }
    return null;
}

function getNextOrderNumber() {
    // Use localStorage cache for instant response
    const stored = localStorage.getItem(SETTINGS_KEY);
    let data = stored ? JSON.parse(stored) : null;
    if (!data) return null;
    // Backward compat
    if (!data.ranges && data.nrStart != null) {
        data = { ranges: [{ start: data.nrStart, end: data.nrEnd }] };
    }
    if (!data.ranges || data.ranges.length === 0) return null;
    if (!data.givenAway) data.givenAway = [];

    const usedNumbers = getUsedOrderNumbers();
    data.givenAway.forEach(r => {
        for (let n = r.start; n <= r.end; n++) usedNumbers.add(String(n));
    });
    return findNextInRanges(data.ranges, usedNumbers);
}

function isNumberInRanges(nr, ranges) {
    const n = parseInt(nr, 10);
    if (isNaN(n)) return false;
    for (const r of ranges) {
        if (n >= r.start && n <= r.end) return true;
    }
    return false;
}

function updateFormTypeChip() {
    // No-op: external forms removed
}


function hasUnsavedServiceChanges() {
    if (!_serviceLastSavedData) return false;
    try {
        return getServiceFormDataSnapshot() !== _serviceLastSavedData;
    } catch (e) {
        return false;
    }
}

function hasUnsavedChanges() {
    if (document.getElementById('service-view').classList.contains('active')) {
        return hasUnsavedServiceChanges();
    }
    if (document.getElementById('kappe-view').classList.contains('active')) {
        return hasUnsavedKappeChanges();
    }
    const currentData = getFormDataSnapshot();
    return lastSavedData !== null
        ? currentData !== lastSavedData
        : hasAnyFormData();
}

function isOnFormPage() {
    if (document.getElementById('saved-modal').classList.contains('active')
        || document.getElementById('settings-modal').classList.contains('active')
        || document.getElementById('template-modal').classList.contains('active')) {
        return false;
    }
    return document.getElementById('view-form').classList.contains('active')
        || document.getElementById('service-view').classList.contains('active')
        || document.getElementById('kappe-view').classList.contains('active');
}

function hasAnyFormData() {
    // Hent standardverdier for sammenligning
    const defaults = safeParseJSON('firesafe_defaults', {});

    // Felt som MÅ ha bruker-input (ikke standardverdier)
    const requiredFields = [
        { id: 'mobile-ordreseddel-nr', default: '' },
        { id: 'mobile-oppdragsgiver', default: defaults.oppdragsgiver || '' },
        { id: 'mobile-prosjektnr', default: defaults.prosjektnr || '' },
        { id: 'mobile-prosjektnavn', default: defaults.prosjektnavn || '' }
    ];

    for (const field of requiredFields) {
        const value = document.getElementById(field.id).value.trim();
        if (value && value !== field.default) return true;
    }

    // Sjekk orders - har de beskrivelse?
    const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    for (const card of orderCards) {
        const descInput = card.querySelector('.mobile-order-desc');
        if (descInput.value.trim()) return true;
    }

    // Sjekk om det er en signatur
    const signature = document.getElementById('mobile-kundens-underskrift').value;
    if (signature) return true;

    return false;
}

function clearForm() {
    document.querySelectorAll('#form-container input, #form-container textarea').forEach(el => el.value = '');
    document.querySelectorAll('#mobile-form input, #mobile-form textarea').forEach(el => {
        el.value = '';
    });

    // Clear signature
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    _setSigneringDatoToday();
    _setUkeToToday();

    sessionStorage.removeItem('firesafe_current');
    sessionStorage.removeItem('firesafe_current_sent');
    document.getElementById('sent-banner').style.display = 'none';
    var btnFormSent = document.getElementById('btn-form-sent');
    if (btnFormSent) btnFormSent.style.display = '';
    lastSavedData = null;
    updateFakturaadresseDisplay('fakturaadresse-display-text', '');

    // Reset orders to 1 empty card
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();

    // Clear desktop work lines
    document.getElementById('work-lines').innerHTML = '';

    window.scrollTo(0, 0);
}

function doNewForm() {
    closeAllModals();
    preNewFormData = getFormData();
    showTemplateModal();
}

function newForm() {
    if (!isOnFormPage()) {
        doNewForm();
        return;
    }

    if (hasUnsavedChanges()) {
        showConfirmModal(t('unsaved_warning'), doNewForm, t('btn_continue'), '#E8501A');
    } else {
        doNewForm();
    }
}

// ============================================
// BULK SELECT MODE (saved-modal)
// ============================================
function toggleSelectMode() {
    _selectMode = !_selectMode;
    _selectedSet.clear();
    var modal = document.getElementById('saved-modal');
    var btn = document.getElementById('saved-select-btn');
    var title = document.getElementById('saved-modal-title');
    if (_selectMode) {
        // Normaliser tab-keys: sessionStorage bruker 'servicebil', men intern
        // _selectTab-verdi er 'service' (matcher eksisterende bulk-build-funksjoner).
        var rawTab = sessionStorage.getItem('firesafe_hent_tab') || 'own';
        _selectTab = (rawTab === 'servicebil') ? 'service' : rawTab;
        modal.classList.add('select-mode');
        document.body.classList.add('bulk-select-active');
        if (btn) { btn.classList.add('active'); btn.textContent = t('btn_cancel'); }
        if (title) title.textContent = t('select_mode_title');
    } else {
        _selectTab = null;
        modal.classList.remove('select-mode');
        document.body.classList.remove('bulk-select-active');
        if (btn) { btn.classList.remove('active'); btn.textContent = t('btn_select'); }
        if (title) title.textContent = t('modal_load_title');
        // Fjern markering fra alle lister (ordreseddel, kappe, og servicebil-uttak-kort)
        document.querySelectorAll(
            '#saved-list .saved-item.selected, ' +
            '#kappe-list .saved-item.selected, ' +
            '#bil-history-list .bil-card-uttak.selected'
        ).forEach(function(el) { el.classList.remove('selected'); });
    }
    updateSelectionUI();
}

function toggleFormSelection(idx, rowEl) {
    var nowSelected = !_selectedSet.has(idx);
    if (nowSelected) _selectedSet.add(idx);
    else _selectedSet.delete(idx);
    // For servicebil kan flere uttak-kort dele samme form-idx (én post per
    // entry i samme arkiverte service-skjema). Marker alle samtidig.
    if (_selectTab === 'service') {
        document.querySelectorAll('#bil-history-list .bil-card-uttak[data-form-idx="' + idx + '"]')
            .forEach(function(el) { el.classList.toggle('selected', nowSelected); });
    } else if (rowEl) {
        rowEl.classList.toggle('selected', nowSelected);
    }
    updateSelectionUI();
}

// Returner valgbare elementer i aktiv tab. For ordreseddel og kappe er det
// .saved-item-kort med data-index. For servicebil er det .bil-card-uttak-kort
// (uttak-poster i bil-history-listen) med data-form-idx — inntak (pafylling)
// kan IKKE velges siden det ikke er et skjema.
function _getSelectableItems() {
    if (_selectTab === 'service') {
        return document.querySelectorAll('#bil-history-list .bil-card-uttak[data-form-idx]');
    }
    if (_selectTab === 'kappe') {
        return document.querySelectorAll('#kappe-list .saved-item[data-index]');
    }
    return document.querySelectorAll('#saved-list .saved-item[data-index]');
}

function _itemSelectionIdx(el) {
    var attr = (_selectTab === 'service') ? 'data-form-idx' : 'data-index';
    var idx = parseInt(el.getAttribute(attr), 10);
    return isNaN(idx) ? null : idx;
}

function updateSelectionUI() {
    var count = _selectedSet.size;
    var countEl = document.getElementById('bulk-count');
    if (countEl) countEl.textContent = count + ' ' + t('bulk_count_suffix');
    var exportBtn = document.getElementById('bulk-export-btn');
    if (exportBtn) exportBtn.disabled = count === 0;

    var selectAllBtn = document.getElementById('bulk-select-all-btn');
    if (selectAllBtn) {
        var items = _getSelectableItems();
        // Alle valgt: alle UNIKE indekser i listen er i _selectedSet.
        // (Servicebil kan ha flere uttak-kort med samme form-idx — duplikater
        // teller som "én valgbar enhet".)
        var uniqueIdxs = {};
        Array.prototype.forEach.call(items, function(el) {
            var idx = _itemSelectionIdx(el);
            if (idx !== null) uniqueIdxs[idx] = true;
        });
        var idxList = Object.keys(uniqueIdxs);
        var allSelected = idxList.length > 0 && idxList.every(function(idx) {
            return _selectedSet.has(parseInt(idx, 10));
        });
        selectAllBtn.textContent = allSelected ? t('btn_deselect_all') : t('btn_select_all');
        selectAllBtn.disabled = idxList.length === 0;
    }
}

function toggleSelectAllVisible() {
    if (!_selectMode) return;
    var items = _getSelectableItems();
    if (items.length === 0) return;
    var uniqueIdxs = {};
    Array.prototype.forEach.call(items, function(el) {
        var idx = _itemSelectionIdx(el);
        if (idx !== null) uniqueIdxs[idx] = true;
    });
    var idxList = Object.keys(uniqueIdxs).map(function(s) { return parseInt(s, 10); });
    if (idxList.length === 0) return;
    var allSelected = idxList.every(function(i) { return _selectedSet.has(i); });
    if (allSelected) {
        idxList.forEach(function(i) { _selectedSet.delete(i); });
    } else {
        idxList.forEach(function(i) { _selectedSet.add(i); });
    }
    // Re-applicer .selected-klasse på alle aktuelle elementer (også duplikater for servicebil)
    Array.prototype.forEach.call(items, function(el) {
        var idx = _itemSelectionIdx(el);
        if (idx === null) return;
        el.classList.toggle('selected', _selectedSet.has(idx));
    });
    updateSelectionUI();
}

function _getSelectedForms() {
    var src;
    if (_selectTab === 'service') src = window.loadedServiceForms || [];
    else if (_selectTab === 'kappe') src = window.loadedKappeForms || [];
    else src = window.loadedForms || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
        if (_selectedSet.has(i)) out.push(src[i]);
    }
    // Sorter etter ordreseddelNr (kun relevant for ordreseddel) for konsistent rekkefølge i PDF
    if (_selectTab !== 'service' && _selectTab !== 'kappe') {
        out.sort(function(a, b) {
            var na = parseInt(a.ordreseddelNr, 10) || 0;
            var nb = parseInt(b.ordreseddelNr, 10) || 0;
            return na - nb;
        });
    }
    return out;
}

// Felles canvas-rendering for eksport/deling
async function renderFormToCanvas() {
    // Sikre at PDF alltid viser dagens dato (også ved re-eksport av sendt skjema).
    // Lagrer opprinnelig verdi og restaurer etter rendering slik at UI-et for
    // sendte skjemaer ikke mister sin historiske dato.
    var _sd = document.getElementById('signering-dato');
    var _msd = document.getElementById('mobile-signering-dato');
    var _origSd = _sd ? _sd.value : null;
    var _origMsd = _msd ? _msd.value : null;
    _setSigneringDatoToday();

    syncMobileToOriginal();

    const element = document.getElementById('form-container');
    const originalDisplay = element.style.display;
    const originalPosition = element.style.position;
    const originalLeft = element.style.left;
    const originalWidth = element.style.width;

    element.style.display = 'block';
    element.style.width = '800px';
    element.style.visibility = 'hidden';
    element.style.position = 'fixed';
    element.style.top = '0';
    element.style.left = '0';

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    const convertedElements = convertTextareasToDiv();

    // Midlertidig fjern disabled for ren eksport
    const disabledFields = element.querySelectorAll('input:disabled, textarea:disabled, select:disabled');
    disabledFields.forEach(el => el.disabled = false);

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    element.style.visibility = 'visible';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '';

    const canvas = await html2canvas(element, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    });

    // Gjenopprett disabled-tilstand
    disabledFields.forEach(el => el.disabled = true);
    restoreTextareas(convertedElements);

    element.style.display = originalDisplay;
    element.style.position = originalPosition;
    element.style.left = originalLeft;
    element.style.width = originalWidth;
    element.style.visibility = '';
    element.style.top = '';

    if (isMobile()) {
        element.style.display = 'none';
    }

    // Restaurer opprinnelig signering-dato (slik at sendte skjema beholder historisk
    // dato i UI — PDF-en er allerede ferdig og inneholder dagens dato).
    if (_sd && _origSd !== null) _sd.value = _origSd;
    if (_msd && _origMsd !== null) _msd.value = _origMsd;

    return canvas;
}

function getExportFilename(ext) {
    var data = (typeof getFormData === 'function') ? getFormData() : {};
    return _filenameForForm(data, 0, 'ordreseddel', ext);
}

async function doExportPDF(markSent) {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const pdf = _createPdfFromCanvas(canvas, 210, 297, 'JPEG', 0.95);
        pdf.save(getExportFilename('pdf'));
        if (markSent) markCurrentFormAsSent();
    } catch (error) {
        showNotificationModal(t('export_pdf_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doExportPNG(markSent) {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const link = document.createElement('a');
        link.download = getExportFilename('png');
        link.href = canvas.toDataURL('image/png');
        link.click();
        if (markSent) markCurrentFormAsSent();
    } catch (error) {
        showNotificationModal(t('export_png_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

// Web Share API krever at navigator.share() kalles innenfor en aktiv user gesture.
// PDF/PNG-generering kan ta lang nok tid (særlig for bulk-eksport) til at gesten
// "går ut" — da feiler share() med "Must be handling a user gesture". Helperen
// fanger denne spesifikke feilen, viser en bekreft-modal, og kaller share() på
// nytt fra OK-handleren (som er en ny user gesture).
//
// Returnerer: 'shared' | 'aborted' | 'error'
async function _safeShare(files) {
    try {
        await navigator.share({ files: files });
        return 'shared';
    } catch (e) {
        if (e.name === 'AbortError') return 'aborted';
        var msg = e.message || '';
        if (/user gesture|user activation|transient activation/i.test(msg)) {
            return new Promise(function(resolve) {
                showConfirmModal(t('share_ready_prompt'), function() {
                    navigator.share({ files: files }).then(function() {
                        resolve('shared');
                    }).catch(function(err) {
                        if (err.name === 'AbortError') {
                            resolve('aborted');
                        } else {
                            showNotificationModal(t('share_error') + err.message);
                            resolve('error');
                        }
                    });
                }, t('btn_share'), '#E8501A');
            });
        }
        showNotificationModal(t('share_error') + msg);
        return 'error';
    }
}

async function doSharePDF(markSent) {
    if (!validateRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderFormToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 210, 297, 'JPEG', 0.95);
        var blob = pdf.output('blob');
        var file = new File([blob], getExportFilename('pdf'), { type: 'application/pdf' });
        loading.classList.remove('active');
        var result = await _safeShare([file]);
        if (result === 'shared' && markSent) markCurrentFormAsSent();
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doSharePNG(markSent) {
    if (!validateRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderFormToCanvas();
        var dataUrl = canvas.toDataURL('image/png');
        var res = await fetch(dataUrl);
        var blob = await res.blob();
        var file = new File([blob], getExportFilename('png'), { type: 'image/png' });
        loading.classList.remove('active');
        var result = await _safeShare([file]);
        if (result === 'shared' && markSent) markCurrentFormAsSent();
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

// ============================================
// BULK EXPORT (multi-select PDF)
// ============================================
// Tvinger #view-form synlig under rendering (nødvendig for html2canvas når vi er i saved-modal).
// Returnerer en restore-funksjon.
// Lager en ny PDF med custom sidestørrelse som matcher canvas-aspect.
function _createPdfFromCanvas(canvas, pageWidth, minHeight, imageType, quality) {
    var jsPDF = window.jspdf.jsPDF;
    var type = imageType || 'PNG';
    var mime = type === 'JPEG' ? 'image/jpeg' : 'image/png';
    var natural = canvas.height * pageWidth / canvas.width;
    var customHeight = Math.max(minHeight, natural);
    var orientation = pageWidth > customHeight ? 'l' : 'p';
    var pdf = new jsPDF({ orientation: orientation, unit: 'mm', format: [pageWidth, customHeight] });
    var dataUrl = (quality != null) ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
    // Tegn med naturlig aspect for å unngå stretching ved kort innhold;
    // resten av siden blir whitespace nederst.
    pdf.addImage(dataUrl, type, 0, 0, pageWidth, Math.min(natural, customHeight));
    return pdf;
}

// Legger til en ny side med custom størrelse på eksisterende PDF, og tegner canvas.
function _addPageFromCanvas(pdf, canvas, pageWidth, minHeight, imageType, quality) {
    var type = imageType || 'PNG';
    var mime = type === 'JPEG' ? 'image/jpeg' : 'image/png';
    var natural = canvas.height * pageWidth / canvas.width;
    var customHeight = Math.max(minHeight, natural);
    var orientation = pageWidth > customHeight ? 'l' : 'p';
    pdf.addPage([pageWidth, customHeight], orientation);
    var dataUrl = (quality != null) ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
    pdf.addImage(dataUrl, type, 0, 0, pageWidth, Math.min(natural, customHeight));
}

// Bytter midlertidig aktiv view til target-view og fjerner body-klasser som skjuler target,
// slik at rendering fungerer identisk med enkelt-skjema-flyten. Loading-overlayet (z-index 10,
// 90% opak) dekker visuell flashing. Returnerer en restore-funksjon.
function _forceViewVisible(viewId) {
    var target = document.getElementById(viewId);
    if (!target) return function() {};

    // Lagre gjeldende aktiv view
    var currentActive = document.querySelector('.view.active');
    var currentActiveId = currentActive ? currentActive.id : null;

    // Lagre og fjern body-klasser som skjuler target via CSS
    // (body.saved-modal-open #view-form { display: none }, osv.)
    var bodyClassesToRestore = [];
    ['saved-modal-open', 'template-modal-open', 'settings-modal-open', 'calculator-modal-open', 'service-view-open', 'kappe-view-open'].forEach(function(cls) {
        if (document.body.classList.contains(cls)) {
            bodyClassesToRestore.push(cls);
            document.body.classList.remove(cls);
        }
    });

    // Switch view
    if (currentActive && currentActive !== target) currentActive.classList.remove('active');
    target.classList.add('active');

    return function() {
        target.classList.remove('active');
        if (currentActive && currentActive !== target) currentActive.classList.add('active');
        bodyClassesToRestore.forEach(function(cls) { document.body.classList.add(cls); });
    };
}

async function _bulkBuildOwnPDF() {
    var forms = _getSelectedForms();
    if (!forms.length) return null;
    var prevSnapshot = null;
    try { prevSnapshot = getFormDataSnapshot(); } catch (e) {}
    var restoreView = _forceViewVisible('view-form');
    var pdf = null;
    try {
        for (var i = 0; i < forms.length; i++) {
            setFormData(forms[i]);
            await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });
            var canvas = await renderFormToCanvas();
            if (!canvas || !canvas.width || !canvas.height) {
                var vf = document.getElementById('view-form');
                var fc = document.getElementById('form-container');
                var vfcs = vf ? getComputedStyle(vf) : {};
                var fccs = fc ? getComputedStyle(fc) : {};
                throw new Error('Tom canvas skjema ' + (i+1) + ' [vf.display=' + (vfcs.display||'?') + ' vf.active=' + (vf?vf.classList.contains('active'):'?') + ' fc.w=' + (fc?fc.offsetWidth:'?') + ' fc.h=' + (fc?fc.offsetHeight:'?') + ' body=' + document.body.className + ']');
            }
            // JPEG er mer robust enn PNG i jsPDF for multi-page bulk
            if (i === 0) {
                pdf = _createPdfFromCanvas(canvas, 210, 297, 'JPEG', 0.95);
            } else {
                _addPageFromCanvas(pdf, canvas, 210, 297, 'JPEG', 0.95);
            }
        }
    } finally {
        restoreView();
        if (prevSnapshot) {
            try { setFormData(JSON.parse(prevSnapshot)); } catch (e) {}
        }
    }
    return pdf;
}

async function _renderServiceCanvasFromData(data) {
    var prev = null;
    try { prev = getServiceFormData(); } catch (e) {}
    setServiceFormData(data);
    await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });
    try {
        return await renderServiceToCanvas();
    } finally {
        if (prev) {
            try { setServiceFormData(prev); } catch (e) {}
        }
    }
}

async function _bulkBuildServicePDF() {
    var forms = _getSelectedForms();
    if (!forms.length) return null;
    var restoreView = _forceViewVisible('service-view');
    var pdf = null;
    try {
        for (var i = 0; i < forms.length; i++) {
            var canvas = await _renderServiceCanvasFromData(forms[i]);
            if (!canvas || !canvas.width || !canvas.height) {
                throw new Error('Tom canvas for skjema ' + (i + 1) + '/' + forms.length);
            }
            if (i === 0) {
                pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
            } else {
                _addPageFromCanvas(pdf, canvas, 297, 210, 'JPEG', 0.95);
            }
        }
    } finally {
        restoreView();
    }
    return pdf;
}

async function _renderKappeCanvasFromData(data) {
    var prev = null;
    try { prev = getKappeFormData(); } catch (e) {}
    setKappeFormData(data);
    await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });
    try {
        return await renderKappeToCanvas();
    } finally {
        if (prev) {
            try { setKappeFormData(prev); } catch (e) {}
        }
    }
}

async function _bulkBuildKappePDF() {
    var forms = _getSelectedForms();
    if (!forms.length) return null;
    var restoreView = _forceViewVisible('kappe-view');
    var pdf = null;
    try {
        for (var i = 0; i < forms.length; i++) {
            var canvas = await _renderKappeCanvasFromData(forms[i]);
            if (!canvas || !canvas.width || !canvas.height) {
                throw new Error('Tom canvas for kappeskjema ' + (i + 1) + '/' + forms.length);
            }
            if (i === 0) {
                pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
            } else {
                _addPageFromCanvas(pdf, canvas, 297, 210, 'JPEG', 0.95);
            }
        }
    } finally {
        restoreView();
    }
    return pdf;
}

// Dagens uke + år, f.eks. "Uke-16-2026"
function _currentUkeYear() {
    var now = new Date();
    return 'Uke-' + getWeekNumber(now) + '-' + now.getFullYear();
}

// Uke + år fra lagret skjema-data. Service-skjema bruker data.uke,
// ordreseddel bruker data.dato (som er tekstfelt f.eks. "Uke 16").
// Bruker savedAt for å bestemme år hvis tilgjengelig.
function _ukeYearForForm(data) {
    var year;
    if (data && data.savedAt) {
        var d = new Date(data.savedAt);
        if (!isNaN(d.getTime())) year = d.getFullYear();
    }
    if (!year) year = new Date().getFullYear();

    var uke;
    var source = (data && data.uke) || (data && data.dato) || '';
    var match = String(source).match(/(\d+)/);
    if (match) {
        var n = parseInt(match[1], 10);
        if (n >= 1 && n <= 53) uke = n;
    }
    if (!uke) uke = getWeekNumber(new Date());

    return 'Uke-' + uke + '-' + year;
}

// Uke-beskrivelse for valgte skjemaer i bulk-samlet:
//  - Alle samme uke:   "Uke-14-2026"
//  - Flere uker, samme år: "Uke-11-15-2026" (min–max)
//  - Flere år:         fallback til dagens uke
function _sharedUkeYearOrRange() {
    var forms = _getSelectedForms();
    if (!forms || forms.length === 0) return _currentUkeYear();

    var ukes = [];
    var years = {};
    for (var i = 0; i < forms.length; i++) {
        var uy = _ukeYearForForm(forms[i]); // "Uke-14-2026"
        var m = uy.match(/Uke-(\d+)-(\d+)/);
        if (!m) continue;
        ukes.push(parseInt(m[1], 10));
        years[m[2]] = true;
    }

    if (ukes.length === 0) return _currentUkeYear();
    var yearKeys = Object.keys(years);
    if (yearKeys.length > 1) return _currentUkeYear();

    var min = Math.min.apply(null, ukes);
    var max = Math.max.apply(null, ukes);
    var year = yearKeys[0];
    return (min === max)
        ? 'Uke-' + min + '-' + year
        : 'Uker-' + min + '-' + max + '-' + year;
}

// ─── Konsistent filnavn-system ──────────────────────────────────────────────
// Alle skjemaer (ordreseddel/servicebil/kappe) følger samme mønster:
//   {type}_{prosjektnavn}_Uke-N-YYYY.{ext}
//   {type}_samlet_Uke-N-YYYY.{ext}  (bulk samlet, samme uke)
//   {type}_samlet_Uker-Min-Max-YYYY.{ext}  (bulk samlet, flere uker)
// Prosjektnavn er gjenkjennelig for mottakere (vs. prosjektnr som er internt).
// Uke er den naturlige perioden — ordreseddel/service sendes ukentlig, og
// for konsistens følger kappe samme mønster (selv om kappe sendes oftere).

function _sanitizeFilenamePart(s) {
    return String(s == null ? '' : s).trim().replace(/[^A-Za-z0-9æøåÆØÅ_-]/g, '_');
}

// Returnerer prosjektnr for et skjema (prosjektnavn som fallback). Service-
// skjemaer har ikke prosjektnr på form-nivå; bruker første ikke-tomme entry.
function _formProsjektId(data, type) {
    if (!data) return '';
    if (type === 'service') {
        var entries = data.entries || [];
        for (var i = 0; i < entries.length; i++) {
            var nr = entries[i] && entries[i].prosjektnr;
            if (nr && String(nr).trim()) return nr;
        }
        for (var j = 0; j < entries.length; j++) {
            var nv = entries[j] && entries[j].prosjektnavn;
            if (nv && nv.trim()) return nv;
        }
        return '';
    }
    return data.prosjektnr || data.prosjektnavn || '';
}

// Konverter kappeskjema-dato (DD.MM.YYYY) til Uke-N-YYYY-streng.
// Ordreseddel/service har data.uke direkte; kappe må parse fra dato.
function _ukeYearForKappeForm(data) {
    if (!data || !data.dato) return _currentUkeYear();
    var m = String(data.dato).match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
    if (!m) return _currentUkeYear();
    var d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    if (isNaN(d.getTime())) return _currentUkeYear();
    return 'Uke-' + getWeekNumber(d) + '-' + d.getFullYear();
}

function _ukeYearForFormByType(data, type) {
    return type === 'kappe' ? _ukeYearForKappeForm(data) : _ukeYearForForm(data);
}

// Bulk-samlet uke-rekkevidde for kappe (samme min/max-mønster som ordreseddel).
function _sharedUkeYearOrRangeKappe() {
    var forms = _getSelectedForms();
    if (!forms || !forms.length) return _currentUkeYear();
    var ukes = [];
    var years = {};
    for (var i = 0; i < forms.length; i++) {
        var uy = _ukeYearForKappeForm(forms[i]);
        var m = uy.match(/Uke-(\d+)-(\d+)/);
        if (!m) continue;
        ukes.push(parseInt(m[1], 10));
        years[m[2]] = true;
    }
    if (!ukes.length) return _currentUkeYear();
    var yearKeys = Object.keys(years);
    if (yearKeys.length > 1) return _currentUkeYear();
    var min = Math.min.apply(null, ukes);
    var max = Math.max.apply(null, ukes);
    var year = yearKeys[0];
    return (min === max) ? 'Uke-' + min + '-' + year : 'Uker-' + min + '-' + max + '-' + year;
}

function _typePrefix(type) {
    return type === 'service' ? 'lageruttak'
         : type === 'kappe'   ? 'kappeskjema'
         :                       'ordreseddel';
}

function _bulkFilename(ext, type) {
    var range = (type === 'kappe') ? _sharedUkeYearOrRangeKappe() : _sharedUkeYearOrRange();
    return _typePrefix(type) + '_samlet_' + range + '.' + (ext || 'pdf');
}

// Per-skjema filnavn (separat bulk-eksport eller fallback).
//   {type}_{prosjektnr}_Uke-N-YYYY.{ext}
// Fallback-rekkefølge når prosjektnr mangler:
//   ordreseddel: prosjektnavn → ordreseddelNr → "skjema_N"
//   kappe:       prosjektnavn → "skjema_N"
//   service:     prosjektnavn (fra første entry) → "skjema_N"
function _filenameForForm(data, fallbackIdx, type, ext) {
    var prefix = _typePrefix(type);
    // For ordreseddel kombineres prosjektnr + ordreseddelnr (begge når de
    // finnes) for å gi unik identifikasjon — samme prosjekt kan motta flere
    // ordresedler i samme uke, og bare prosjektnr ville gitt filnavn-
    // kollisjon. Lageruttak og kappeskjema bruker bare prosjektnr (de har
    // ingen ordrenummer-ekvivalent på form-nivå). Manglende type → ordreseddel.
    var isOrdreseddel = !type || type === 'ordreseddel';
    var name;
    if (isOrdreseddel) {
        var parts = [];
        var pnr = (data && data.prosjektnr) ? String(data.prosjektnr).trim() : '';
        var oNr = (data && data.ordreseddelNr) ? String(data.ordreseddelNr).trim() : '';
        if (pnr) parts.push(pnr);
        if (oNr) parts.push(oNr);
        if (parts.length) {
            name = parts.join('_');
        } else if (data && data.prosjektnavn) {
            name = data.prosjektnavn;
        } else {
            name = 'skjema_' + (fallbackIdx + 1);
        }
    } else {
        name = _formProsjektId(data, type);
        if (!name) name = 'skjema_' + (fallbackIdx + 1);
    }
    var uke = _ukeYearForFormByType(data, type);
    return prefix + '_' + _sanitizeFilenamePart(name) + '_' + uke + '.' + ext;
}

function _pngFilenameForForm(data, fallbackIdx, type) {
    return _filenameForForm(data, fallbackIdx, type, 'png');
}

function _pdfFilenameForForm(data, fallbackIdx, type) {
    return _filenameForForm(data, fallbackIdx, type, 'pdf');
}

// Render alle valgte til separate PDF-filer (én per skjema)
async function _bulkBuildOwnPDFsSeparate() {
    var forms = _getSelectedForms();
    if (!forms.length) return [];
    var prevSnapshot = null;
    try { prevSnapshot = getFormDataSnapshot(); } catch (e) {}
    var restoreView = _forceViewVisible('view-form');
    var files = [];
    try {
        for (var i = 0; i < forms.length; i++) {
            setFormData(forms[i]);
            await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });
            var canvas = await renderFormToCanvas();
            if (!canvas || !canvas.width || !canvas.height) {
                throw new Error('Tom canvas for skjema ' + (i + 1) + '/' + forms.length);
            }
            var pdf = _createPdfFromCanvas(canvas, 210, 297, 'JPEG', 0.95);
            var blob = pdf.output('blob');
            files.push(new File([blob], _pdfFilenameForForm(forms[i], i), { type: 'application/pdf' }));
        }
    } finally {
        restoreView();
        if (prevSnapshot) {
            try { setFormData(JSON.parse(prevSnapshot)); } catch (e) {}
        }
    }
    return files;
}

async function _bulkBuildServicePDFsSeparate() {
    var forms = _getSelectedForms();
    if (!forms.length) return [];
    var restoreView = _forceViewVisible('service-view');
    var files = [];
    try {
        for (var i = 0; i < forms.length; i++) {
            var canvas = await _renderServiceCanvasFromData(forms[i]);
            if (!canvas || !canvas.width || !canvas.height) {
                throw new Error('Tom canvas for skjema ' + (i + 1) + '/' + forms.length);
            }
            var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
            var blob = pdf.output('blob');
            files.push(new File([blob], _pdfFilenameForForm(forms[i], i, 'service'), { type: 'application/pdf' }));
        }
    } finally {
        restoreView();
    }
    return files;
}

async function _bulkBuildKappePDFsSeparate() {
    var forms = _getSelectedForms();
    if (!forms.length) return [];
    var restoreView = _forceViewVisible('kappe-view');
    var files = [];
    try {
        for (var i = 0; i < forms.length; i++) {
            var canvas = await _renderKappeCanvasFromData(forms[i]);
            if (!canvas || !canvas.width || !canvas.height) {
                throw new Error('Tom canvas for kappeskjema ' + (i + 1) + '/' + forms.length);
            }
            var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
            var blob = pdf.output('blob');
            files.push(new File([blob], _pdfFilenameForForm(forms[i], i, 'kappe'), { type: 'application/pdf' }));
        }
    } finally {
        restoreView();
    }
    return files;
}

// Render alle valgte til PNG-filer (returnerer array av File-objekter)
async function _bulkBuildOwnPNGs() {
    var forms = _getSelectedForms();
    if (!forms.length) return [];
    var prevSnapshot = null;
    try { prevSnapshot = getFormDataSnapshot(); } catch (e) {}
    var restoreView = _forceViewVisible('view-form');
    var files = [];
    try {
        for (var i = 0; i < forms.length; i++) {
            setFormData(forms[i]);
            await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });
            var canvas = await renderFormToCanvas();
            var blob = await new Promise(function(res) { canvas.toBlob(res, 'image/png'); });
            files.push(new File([blob], _pngFilenameForForm(forms[i], i), { type: 'image/png' }));
        }
    } finally {
        restoreView();
        if (prevSnapshot) {
            try { setFormData(JSON.parse(prevSnapshot)); } catch (e) {}
        }
    }
    return files;
}

async function _bulkBuildServicePNGs() {
    var forms = _getSelectedForms();
    if (!forms.length) return [];
    var restoreView = _forceViewVisible('service-view');
    var files = [];
    try {
        for (var i = 0; i < forms.length; i++) {
            var canvas = await _renderServiceCanvasFromData(forms[i]);
            var blob = await new Promise(function(res) { canvas.toBlob(res, 'image/png'); });
            files.push(new File([blob], _pngFilenameForForm(forms[i], i, 'service'), { type: 'image/png' }));
        }
    } finally {
        restoreView();
    }
    return files;
}

async function _bulkBuildKappePNGs() {
    var forms = _getSelectedForms();
    if (!forms.length) return [];
    var restoreView = _forceViewVisible('kappe-view');
    var files = [];
    try {
        for (var i = 0; i < forms.length; i++) {
            var canvas = await _renderKappeCanvasFromData(forms[i]);
            var blob = await new Promise(function(res) { canvas.toBlob(res, 'image/png'); });
            files.push(new File([blob], _pngFilenameForForm(forms[i], i, 'kappe'), { type: 'image/png' }));
        }
    } finally {
        restoreView();
    }
    return files;
}

// Mark-as-sent helpere (uten UI-støy, brukt i bulk).
// VIKTIG: savedAt må bumpes slik at _mergeAndDedup velger arkiv-versjonen over saved-versjonen
// (samme mekanisme som getFormData() i enkelt-skjema-flyten).
function _markOwnFormDataAsSent(sourceData) {
    try {
        // Clone to avoid mutating window.loadedForms entry
        var data = JSON.parse(JSON.stringify(sourceData));
        // Strip internal flags som ikke skal lagres
        delete data._isSent;
        data.savedAt = new Date().toISOString();

        var saved = safeParseJSON(STORAGE_KEY, []);
        var idx = saved.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (idx !== -1 && !data.id) data.id = saved[idx].id;
        if (!data.id) data.id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
        var archived = safeParseJSON(ARCHIVE_KEY, []);
        var archIdx = archived.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (archIdx !== -1) archived[archIdx] = data;
        else archived.unshift(data);
        safeSetItem(ARCHIVE_KEY, JSON.stringify(archived));
        addToOrderNumberIndex(data.ordreseddelNr);
        enqueueUserDocMove('archive', 'forms', data.id, data, 'Bulk mark-sent (own)');
    } catch (e) { console.error('Bulk mark-sent (own) error:', e); }
}

function _markServiceFormDataAsSent(sourceData) {
    try {
        var data = JSON.parse(JSON.stringify(sourceData));
        delete data._isSent;
        data.savedAt = new Date().toISOString();

        if (!data.id) data.id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
        var archived = safeParseJSON(SERVICE_ARCHIVE_KEY, []);
        var archIdx = archived.findIndex(function(item) { return item.id === data.id; });
        if (archIdx !== -1) archived[archIdx] = data;
        else archived.unshift(data);
        safeSetItem(SERVICE_ARCHIVE_KEY, JSON.stringify(archived));
        var saved = safeParseJSON(SERVICE_STORAGE_KEY, []);
        var savedIdx = saved.findIndex(function(item) { return item.id === data.id; });
        if (savedIdx !== -1) {
            saved.splice(savedIdx, 1);
            safeSetItem(SERVICE_STORAGE_KEY, JSON.stringify(saved));
        }
        enqueueUserDocMove('serviceArchive', 'serviceforms', data.id, data, 'Bulk mark-sent (service)');
    } catch (e) { console.error('Bulk mark-sent (service) error:', e); }
}

function _markKappeFormDataAsSent(sourceData) {
    try {
        var data = JSON.parse(JSON.stringify(sourceData));
        delete data._isSent;
        data.savedAt = new Date().toISOString();

        if (!data.id) data.id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
        var archived = safeParseJSON(KAPPE_ARCHIVE_KEY, []);
        var archIdx = archived.findIndex(function(item) { return item.id === data.id; });
        if (archIdx !== -1) archived[archIdx] = data;
        else archived.unshift(data);
        safeSetItem(KAPPE_ARCHIVE_KEY, JSON.stringify(archived));
        var saved = safeParseJSON(KAPPE_STORAGE_KEY, []);
        var savedIdx = saved.findIndex(function(item) { return item.id === data.id; });
        if (savedIdx !== -1) {
            saved.splice(savedIdx, 1);
            safeSetItem(KAPPE_STORAGE_KEY, JSON.stringify(saved));
        }
        enqueueUserDocMove('kappeArchive', 'kappeforms', data.id, data, 'Bulk mark-sent (kappe)');
    } catch (e) { console.error('Bulk mark-sent (kappe) error:', e); }
}

function _bulkMarkSelectedAsSent() {
    var forms = _getSelectedForms();
    for (var i = 0; i < forms.length; i++) {
        if (forms[i]._isSent) continue; // already sent
        if (_selectTab === 'service') _markServiceFormDataAsSent(forms[i]);
        else if (_selectTab === 'kappe') _markKappeFormDataAsSent(forms[i]);
        else _markOwnFormDataAsSent(forms[i]);
    }
    _lastLocalSaveTs = Date.now();
}

function _bulkHasUnsentSelected() {
    var forms = _getSelectedForms();
    for (var i = 0; i < forms.length; i++) {
        if (!forms[i]._isSent) return true;
    }
    return false;
}

// Eksport-meny for bulk (identisk pattern som showExportMenu for enkeltskjema)
function showBulkExportMenu() {
    if (_selectedSet.size === 0) return;
    var popup = document.getElementById('action-popup');
    document.getElementById('action-popup-title').textContent = t('bulk_export_title') + ' (' + _selectedSet.size + ')';
    var buttonsEl = document.getElementById('action-popup-buttons');
    var showCheckbox = _bulkHasUnsentSelected();
    var checkboxHtml = showCheckbox
        ? '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;padding:4px 0">' +
              '<input type="checkbox" id="bulk-export-mark-sent" style="width:22px;height:22px;accent-color:#E8501A;flex-shrink:0">' +
              t('bulk_mark_sent_label') +
          '</label>'
        : '';
    var combinedCheckboxHtml =
        '<label style="display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;font-size:14px;padding:4px 0">' +
            '<input type="checkbox" id="bulk-export-combined" checked onchange="_updateBulkPngState()" style="width:22px;height:22px;accent-color:#E8501A;flex-shrink:0">' +
            t('bulk_combine_pdf_label') +
        '</label>';
    var shareIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    var dlIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
    var canShare = !!(navigator.share && navigator.canShare);
    var mr = "document.getElementById('bulk-export-mark-sent')?.checked";
    // Runtime-dispatch: checkbox styrer om PDF-knappen bruker samlet eller separat
    var pdfDl = '(document.getElementById(\'bulk-export-combined\')?.checked ? doBulkExportPDF(' + mr + ') : doBulkExportPDFSeparate(' + mr + '))';
    var pdfShare = '(document.getElementById(\'bulk-export-combined\')?.checked ? doBulkSharePDF(' + mr + ') : doBulkSharePDFSeparate(' + mr + '))';
    var pngDl = 'doBulkExportPNG(' + mr + ')';
    var pngShare = 'doBulkSharePNG(' + mr + ')';

    var shareBtnPDF = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="' + pdfShare + '; closeActionPopup()">' + shareIcon + ' PDF</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PDF</button>';
    var shareBtnPNG = canShare
        ? '<button class="confirm-btn-ok bulk-png-btn" style="background:#E8501A" onclick="' + pngShare + '; closeActionPopup()">' + shareIcon + ' PNG</button>'
        : '<button class="confirm-btn-ok bulk-png-btn" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PNG</button>';

    var html = checkboxHtml + combinedCheckboxHtml +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('export_download') + '</div>' +
        '<div class="confirm-modal-buttons" style="margin-bottom:12px">' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="' + pdfDl + '; closeActionPopup()">' + dlIcon + ' PDF</button>' +
            '<button class="confirm-btn-ok bulk-png-btn" style="background:#333" onclick="' + pngDl + '; closeActionPopup()">' + dlIcon + ' PNG</button>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('btn_share') + '</div>' +
        '<div class="confirm-modal-buttons">' +
            shareBtnPDF + shareBtnPNG +
        '</div>';
    buttonsEl.innerHTML = html;
    popup.classList.add('active');
    _updateBulkPngState();
}

function _updateBulkPngState() {
    var combined = document.getElementById('bulk-export-combined');
    if (!combined) return;
    var disable = combined.checked;
    var DISABLED_STYLE = 'background:#e5e5e5 !important;background-color:#e5e5e5 !important;color:#a0a0a0 !important;cursor:not-allowed !important;pointer-events:none !important;border:none !important;box-shadow:none !important;';
    document.querySelectorAll('.bulk-png-btn').forEach(function(btn) {
        if (disable) {
            if (btn.dataset.origStyle === undefined) btn.dataset.origStyle = btn.getAttribute('style') || '';
            btn.setAttribute('style', DISABLED_STYLE);
            btn.disabled = true;
            // Force SVG stroke color too (inherits from `color` which we already set, but be explicit)
            btn.querySelectorAll('svg').forEach(function(svg) {
                svg.style.setProperty('stroke', '#a0a0a0', 'important');
                svg.style.setProperty('color', '#a0a0a0', 'important');
            });
        } else {
            btn.setAttribute('style', btn.dataset.origStyle || '');
            delete btn.dataset.origStyle;
            btn.disabled = false;
            btn.querySelectorAll('svg').forEach(function(svg) {
                svg.style.removeProperty('stroke');
                svg.style.removeProperty('color');
            });
        }
    });
}

async function _bulkFinishAfterExport(markSent) {
    var tabForRefresh = _selectTab;  // capture FØR toggleSelectMode nullstiller _selectTab
    if (markSent) _bulkMarkSelectedAsSent();
    toggleSelectMode();
    if (markSent) {
        // Refresh saved list slik at sendt-status vises korrekt
        _showSavedFormsDirectly(tabForRefresh || 'own');
    }
}

async function doBulkExportPDF(markSent) {
    if (_selectedSet.size === 0) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var pdf = _selectTab === 'service' ? await _bulkBuildServicePDF() : (_selectTab === 'kappe' ? await _bulkBuildKappePDF() : await _bulkBuildOwnPDF());
        if (pdf) pdf.save(_bulkFilename('pdf', _selectTab));
        await _bulkFinishAfterExport(markSent);
    } catch (e) {
        showNotificationModal(t('export_pdf_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doBulkExportPNG(markSent) {
    if (_selectedSet.size === 0) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var files = _selectTab === 'service' ? await _bulkBuildServicePNGs() : (_selectTab === 'kappe' ? await _bulkBuildKappePNGs() : await _bulkBuildOwnPNGs());
        for (var i = 0; i < files.length; i++) {
            var url = URL.createObjectURL(files[i]);
            var a = document.createElement('a');
            a.href = url;
            a.download = files[i].name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function(u) { return function() { URL.revokeObjectURL(u); }; }(url), 2000);
            // Small delay between downloads so browsers don't coalesce or block
            await new Promise(function(r) { setTimeout(r, 150); });
        }
        await _bulkFinishAfterExport(markSent);
    } catch (e) {
        showNotificationModal(t('export_png_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doBulkSharePDF(markSent) {
    if (_selectedSet.size === 0) return;
    if (!(navigator.share && navigator.canShare)) {
        showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
        return;
    }
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var pdf = _selectTab === 'service' ? await _bulkBuildServicePDF() : (_selectTab === 'kappe' ? await _bulkBuildKappePDF() : await _bulkBuildOwnPDF());
        if (!pdf) return;
        var blob = pdf.output('blob');
        var file = new File([blob], _bulkFilename('pdf', _selectTab), { type: 'application/pdf' });
        if (!navigator.canShare({ files: [file] })) {
            showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
            return;
        }
        loading.classList.remove('active');
        var result = await _safeShare([file]);
        if (result === 'shared') await _bulkFinishAfterExport(markSent);
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doBulkSharePNG(markSent) {
    if (_selectedSet.size === 0) return;
    if (!(navigator.share && navigator.canShare)) {
        showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
        return;
    }
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var files = _selectTab === 'service' ? await _bulkBuildServicePNGs() : (_selectTab === 'kappe' ? await _bulkBuildKappePNGs() : await _bulkBuildOwnPNGs());
        if (!files.length) return;
        if (!navigator.canShare({ files: files })) {
            showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
            return;
        }
        loading.classList.remove('active');
        var result = await _safeShare(files);
        if (result === 'shared') await _bulkFinishAfterExport(markSent);
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

// Separate PDF-filer (én per skjema)
async function doBulkExportPDFSeparate(markSent) {
    if (_selectedSet.size === 0) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var files = _selectTab === 'service' ? await _bulkBuildServicePDFsSeparate() : (_selectTab === 'kappe' ? await _bulkBuildKappePDFsSeparate() : await _bulkBuildOwnPDFsSeparate());
        for (var i = 0; i < files.length; i++) {
            var url = URL.createObjectURL(files[i]);
            var a = document.createElement('a');
            a.href = url;
            a.download = files[i].name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function(u) { return function() { URL.revokeObjectURL(u); }; }(url), 2000);
            await new Promise(function(r) { setTimeout(r, 150); });
        }
        await _bulkFinishAfterExport(markSent);
    } catch (e) {
        showNotificationModal(t('export_pdf_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doBulkSharePDFSeparate(markSent) {
    if (_selectedSet.size === 0) return;
    if (!(navigator.share && navigator.canShare)) {
        showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
        return;
    }
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var files = _selectTab === 'service' ? await _bulkBuildServicePDFsSeparate() : (_selectTab === 'kappe' ? await _bulkBuildKappePDFsSeparate() : await _bulkBuildOwnPDFsSeparate());
        if (!files.length) return;
        if (!navigator.canShare({ files: files })) {
            showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
            return;
        }
        loading.classList.remove('active');
        var result = await _safeShare(files);
        if (result === 'shared') await _bulkFinishAfterExport(markSent);
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

// ============================================
// SERVICE FORM FUNCTIONS
// ============================================

var _serviceCurrentId = null; // Track current loaded service form id
var _serviceLastSavedData = null; // For unsaved changes detection
var _servicebilMode = 'inntak';

// Sett aktiv modus i Servicebil-view (inntak/uttak). Skjuler/viser seksjoner
// via body-klasse og oppdaterer toggle-knappenes aktive tilstand.
function _setServicebilMode(mode) {
    if (mode !== 'inntak' && mode !== 'uttak') return;
    var prevMode = _servicebilMode;
    // Hvis picker er åpen og bruker bytter modus, lukk picker først
    if (mode !== prevMode && document.body.classList.contains('picker-active') && typeof closePickerOverlay === 'function') {
        closePickerOverlay();
    }
    _servicebilMode = mode;
    // Persister modus så reload/hashchange kan gjenopprette riktig tilstand
    try { sessionStorage.setItem('firesafe_servicebil_mode', mode); } catch (e) {}
    document.body.classList.toggle('servicebil-inntak-mode', mode === 'inntak');
    document.body.classList.toggle('servicebil-uttak-mode', mode === 'uttak');
    document.querySelectorAll('#servicebil-mode-toggle .mode-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    // Hvis brukeren bytter TIL Inntak (fra Uttak) og det ikke er materialer der,
    // auto-åpne picker. Inntak ER en material-picker.
    if (mode === 'inntak' && prevMode === 'uttak') {
        var container = document.getElementById('servicebil-inntak-materials');
        var hasMaterials = container && container.querySelectorAll('.mobile-material-row').length > 0;
        if (!hasMaterials) {
            requestAnimationFrame(function() {
                openMaterialPicker(null, function(materials) {
                    if (materials && materials.length > 0) {
                        saveBilPafylling(materials);
                        closeServiceView();
                        _showSavedFormsDirectly('servicebil');
                    }
                });
            });
        }
    }
}

// Hovedinngang: åpner Servicebil-view i valgt modus (default Inntak).
// I Inntak-modus auto-åpnes material-picker siden Inntak ER bare en picker.
function openServicebilView(defaultMode) {
    defaultMode = defaultMode || 'inntak';
    var inntakContainer = document.getElementById('servicebil-inntak-materials');
    if (inntakContainer) inntakContainer.innerHTML = '';
    openNewServiceForm();
    _setServicebilMode(defaultMode);

    if (defaultMode === 'inntak') {
        // Auto-åpne material-picker — bruker har "valgt" Inntak ved å trykke + Servicebil
        requestAnimationFrame(function() {
            openMaterialPicker(null, function(materials) {
                if (materials && materials.length > 0) {
                    saveBilPafylling(materials);
                    closeServiceView();
                    _showSavedFormsDirectly('servicebil');
                }
                // Hvis bruker avbryter: view forblir åpen — kan toggle til Uttak
                // eller bruke "+ Materialer"-knappen som fallback
            });
        });
    }
}

// Bakoverkompatibel alias — gammel onclick="openBilPafylling()" rute hit nå.
function openBilPafylling() {
    openServicebilView('inntak');
}

// Lagre-dispatcher som velger riktig flyt basert på modus.
async function saveServicebilForm() {
    if (_servicebilMode === 'inntak') {
        // Hvis picker er åpen, deleger til pickerOverlayConfirm — den triggrer
        // callbacken fra openServicebilView som gjør save+close+redirect.
        if (document.body.classList.contains('picker-active') && typeof pickerOverlayConfirm === 'function') {
            pickerOverlayConfirm();
            return;
        }
        var container = document.getElementById('servicebil-inntak-materials');
        var materials = container && typeof getMaterialsFromContainer === 'function'
            ? getMaterialsFromContainer(container)
            : [];
        if (!materials || materials.length === 0) {
            showNotificationModal(t('servicebil_inntak_no_materials'));
            return;
        }
        saveBilPafylling(materials);
        if (typeof closeServiceView === 'function') closeServiceView();
        _showSavedFormsDirectly('servicebil');
    } else {
        await saveServiceForm();
    }
}

function openNewServiceForm() {
    // Close template modal
    document.body.classList.remove('template-modal-open');

    // Reset service form. Uke og entry-dato er alltid dagens (system-styrt).
    var serviceDefaults = getMinInfo();
    document.getElementById('service-montor').value = (serviceDefaults.autofill_montor !== false) ? (serviceDefaults.montor || '') : '';
    var ukeField = document.getElementById('service-uke');
    if (ukeField) ukeField.value = String(getWeekNumber(new Date()));
    document.getElementById('service-signatur').value = '';
    window._serviceSignaturePaths = [];
    _serviceCurrentId = null;
    var srvPreviewImg = document.getElementById('service-signature-preview-img');
    if (srvPreviewImg) { srvPreviewImg.style.display = 'none'; srvPreviewImg.src = ''; }
    var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
    if (srvPlaceholder) srvPlaceholder.style.display = '';

    // Init empty entry med dagens dato
    var container = document.getElementById('service-entries');
    container.innerHTML = '';
    var entryData = { dato: formatDate(new Date()) };
    container.appendChild(createServiceEntryCard(entryData, true));
    renumberServiceEntries();
    updateServiceDeleteStates();

    // Set up service view state before showing
    document.getElementById('service-sent-banner').style.display = 'none';
    document.getElementById('btn-service-sent').style.display = '';
    document.getElementById('service-save-btn').disabled = false;
    sessionStorage.removeItem('firesafe_service_sent');
    _serviceLastSavedData = getServiceFormDataSnapshot();
    sessionStorage.setItem('firesafe_service_current', _serviceLastSavedData);

    // Show service view after content is ready
    showView('service-view');
    document.body.classList.add('service-view-open');
    window.location.hash = 'service';

    // Scroll to top after all content is set
    requestAnimationFrame(function() {
        document.getElementById('service-view').scrollTop = 0;
        window.scrollTo(0, 0);
    });
}

function closeServiceView() {
    // Hvis picker er åpen (typisk i auto-åpnet Inntak-modus), lukk den først
    // så den ikke forblir synlig over hjem-siden etter navigasjon.
    if (document.body.classList.contains('picker-active') && typeof closePickerOverlay === 'function') {
        closePickerOverlay();
    }
    document.body.classList.remove('service-view-open');
    document.body.classList.remove('servicebil-inntak-mode', 'servicebil-uttak-mode');
    _serviceCurrentId = null;
    _serviceLastSavedData = null;
    sessionStorage.removeItem('firesafe_service_current');
    sessionStorage.removeItem('firesafe_service_sent');
    sessionStorage.removeItem('firesafe_servicebil_mode');

    // Clear service signature preview
    document.getElementById('service-signatur').value = '';
    window._serviceSignaturePaths = [];
    var srvPreviewImg = document.getElementById('service-signature-preview-img');
    if (srvPreviewImg) { srvPreviewImg.style.display = 'none'; srvPreviewImg.src = ''; }
    var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
    if (srvPlaceholder) srvPlaceholder.style.display = '';
}

async function saveServiceForm() {
    if (!validateServiceRequiredFields()) return;

    var saveBtn = document.getElementById('service-save-btn');
    if (saveBtn && saveBtn.disabled) return;
    if (saveBtn) saveBtn.disabled = true;

    try {
        var data = getServiceFormData();

        var saved = safeParseJSON(SERVICE_STORAGE_KEY, []);
        var archived = safeParseJSON(SERVICE_ARCHIVE_KEY, []);

        // Check if we're re-saving a sent form
        var wasSent = sessionStorage.getItem('firesafe_service_sent') === '1';
        if (wasSent && _serviceCurrentId) {
            var archivedIdx = archived.findIndex(function(item) { return item.id === _serviceCurrentId; });
            if (archivedIdx !== -1) {
                data.id = _serviceCurrentId;
                archived.splice(archivedIdx, 1);
                safeSetItem(SERVICE_ARCHIVE_KEY, JSON.stringify(archived));
            }
        }

        if (_serviceCurrentId) {
            // Update existing
            data.id = _serviceCurrentId;
            var existingIndex = saved.findIndex(function(item) { return item.id === _serviceCurrentId; });
            if (existingIndex !== -1) {
                saved[existingIndex] = data;
            } else {
                saved.unshift(data);
            }
        } else {
            // New form
            data.id = Date.now().toString();
            saved.unshift(data);
        }

        if (saved.length > 50) saved.pop();
        safeSetItem(SERVICE_STORAGE_KEY, JSON.stringify(saved));
        _serviceCurrentId = data.id;
        _serviceLastSavedData = getServiceFormDataSnapshot();
        _lastLocalSaveTs = Date.now();

        // Clear sent state
        var wasSentService = sessionStorage.getItem('firesafe_service_sent') === '1';
        sessionStorage.removeItem('firesafe_service_sent');
        document.getElementById('service-sent-banner').style.display = 'none';
        document.getElementById('btn-service-sent').style.display = '';

        showNotificationModal(t('service_save_success'), true);
        sessionStorage.setItem('firesafe_service_current', JSON.stringify(data));
        if (!wasSentService) {
            closeServiceView();
            _showSavedFormsDirectly('service');
        }

        if (wasSent) {
            enqueueUserDocMove('serviceforms', 'serviceArchive', data.id, data, 'Service save Firebase');
        } else {
            enqueueUserDocSet('serviceforms', data.id, data, 'Service save Firebase');
        }
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function _buildServiceItemHtml(item, index) {
    // Build title: prefer top-level uke-felt (new), fallback til å utlede fra første entry-dato (gamle skjema)
    var title = '';
    if (item.uke) {
        var ukeMatch = String(item.uke).match(/(\d+)/);
        title = ukeMatch ? 'Uke ' + ukeMatch[1] : String(item.uke);
    } else {
        var entry = item.entries && item.entries[0] ? item.entries[0] : {};
        var entryDato = entry.dato || '';
        if (entryDato) {
            var d = parseDateDMY(entryDato);
            if (d) {
                title = 'Uke ' + getWeekNumber(d);
            } else {
                title = entryDato;
            }
        }
    }
    // Subtitle: prosjektnr + prosjektnavn
    var serviceSubtitle = '';
    var projectParts = [];
    if (entry.prosjektnr) projectParts.push(escapeHtml(entry.prosjektnr));
    if (entry.prosjektnavn) projectParts.push(escapeHtml(entry.prosjektnavn));
    if (projectParts.length > 0) {
        serviceSubtitle = '<div class="saved-item-subtitle">' + projectParts.join(' <span class="bil-history-sep"></span> ') + '</div>';
    }
    var savedAtStr = formatDateWithTime(item.savedAt);
    var isSent = item._isSent;
    var dot = '<span class="status-dot ' + (isSent ? 'sent' : 'saved') + '"></span>';
    var dupBtn = '<button class="saved-item-action-btn copy" title="' + t('duplicate_btn') + '">' + duplicateIcon + '</button>';
    var deleteBtn = isSent
        ? '<button class="saved-item-action-btn delete disabled" title="' + t('delete_btn') + '">' + deleteIcon + '</button>'
        : '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>';
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-header">' +
                '<div class="saved-item-row1">' + dot + escapeHtml(title || t('no_name')) + (savedAtStr ? '<span class="saved-item-date-inline">' + escapeHtml(savedAtStr) + '</span>' : '') + '</div>' +
            '</div>' +
            serviceSubtitle +
        '</div>' +
        '<div class="saved-item-buttons">' + dupBtn + deleteBtn + '</div>' +
    '</div>';
}

function renderServiceFormsList(forms) {
    var listEl = document.getElementById('service-list');
    if (!forms || forms.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('service_no_saved') + '</div>';
        window.loadedServiceForms = [];
        return;
    }
    window.loadedServiceForms = forms;
    listEl.innerHTML = forms.map(function(item, i) { return _buildServiceItemHtml(item, i); }).join('');
    // Attach form data to DOM elements
    listEl.querySelectorAll('.saved-item').forEach(function(el, i) {
        el._formData = window.loadedServiceForms[i];
    });

    if (_selectMode) {
        listEl.querySelectorAll('.saved-item').forEach(function(el) {
            var idx = parseInt(el.getAttribute('data-index'), 10);
            if (!isNaN(idx) && _selectedSet.has(idx)) el.classList.add('selected');
        });
        updateSelectionUI();
    }
}

function loadServiceFormDirect(formData) {
    if (!formData) return;

    // Close saved modal
    document.body.classList.remove('saved-modal-open');
    sessionStorage.removeItem('firesafe_hent_tab');

    // Set data
    _serviceCurrentId = formData.id || null;
    setServiceFormData(formData);

    // Hvis ikke sendt: oppdater Uke til dagens uke (entry-datoer bevares — historisk)
    if (!formData._isSent) {
        var ukeField = document.getElementById('service-uke');
        if (ukeField) ukeField.value = String(getWeekNumber(new Date()));
    }

    // Show service view
    showView('service-view');
    document.body.classList.add('service-view-open');
    window.location.hash = 'service';

    var isSent = !!formData._isSent;
    document.getElementById('service-sent-banner').style.display = isSent ? 'block' : 'none';
    document.getElementById('btn-service-sent').style.display = isSent ? 'none' : '';
    sessionStorage.setItem('firesafe_service_sent', isSent ? '1' : '');
    _serviceLastSavedData = getServiceFormDataSnapshot();
    sessionStorage.setItem('firesafe_service_current', _serviceLastSavedData);
    window.scrollTo(0, 0);
}

function duplicateServiceForm(formData) {
    if (!formData) return;
    var copy = JSON.parse(JSON.stringify(formData));
    // Clear ID and sent state
    delete copy.id;
    delete copy._isSent;
    copy.savedAt = new Date().toISOString();

    // Clear signature
    copy.signatureImage = '';
    copy.signaturePaths = [];

    // Dupliser starter som nytt skjema — uke og alle entry-datoer settes til i dag
    if (copy.entries) {
        var today = formatDate(new Date());
        copy.entries.forEach(function(entry) { entry.dato = today; });
    }
    copy.uke = String(getWeekNumber(new Date()));

    // Load into form
    _serviceCurrentId = null;
    setServiceFormData(copy);

    // Close modal and show service view
    document.body.classList.remove('saved-modal-open');
    sessionStorage.removeItem('firesafe_hent_tab');
    showView('service-view');
    document.body.classList.add('service-view-open');
    window.location.hash = 'service';
    document.getElementById('service-sent-banner').style.display = 'none';
    document.getElementById('btn-service-sent').style.display = '';
    document.getElementById('service-save-btn').disabled = false;
    sessionStorage.removeItem('firesafe_service_sent');
    _serviceLastSavedData = getServiceFormDataSnapshot();
    sessionStorage.setItem('firesafe_service_current', _serviceLastSavedData);
    window.scrollTo(0, 0);
    showNotificationModal(t('duplicated_success'), true);
}

function deleteServiceForm(formData) {
    if (!formData) return;
    var isSent = formData._isSent;
    showConfirmModal(t(isSent ? 'delete_sent_confirm' : 'delete_confirm'), function() {
        var lsKey = isSent ? SERVICE_ARCHIVE_KEY : SERVICE_STORAGE_KEY;
        var col = isSent ? 'serviceArchive' : 'serviceforms';
        var list = safeParseJSON(lsKey, []);
        var idx = list.findIndex(function(f) { return f.id === formData.id; });
        if (idx !== -1) { list.splice(idx, 1); safeSetItem(lsKey, JSON.stringify(list)); }
        // Remove from loaded list
        var loadedIdx = window.loadedServiceForms.findIndex(function(f) { return f.id === formData.id; });
        if (loadedIdx !== -1) window.loadedServiceForms.splice(loadedIdx, 1);
        renderServiceFormsList(window.loadedServiceForms);
        _lastLocalSaveTs = Date.now();
        enqueueUserDocDelete(col, formData.id, 'Delete service form');
    });
}

function markServiceAsSent() {
    try {
        if (!validateServiceRequiredFields()) return;
        var data = getServiceFormData();

        var saved = safeParseJSON(SERVICE_STORAGE_KEY, []);
        if (_serviceCurrentId) {
            data.id = _serviceCurrentId;
        } else {
            data.id = Date.now().toString();
        }

        var archived = safeParseJSON(SERVICE_ARCHIVE_KEY, []);
        var archivedExisting = archived.findIndex(function(item) { return item.id === data.id; });
        if (archivedExisting !== -1) {
            archived[archivedExisting] = data;
        } else {
            archived.unshift(data);
        }
        safeSetItem(SERVICE_ARCHIVE_KEY, JSON.stringify(archived));

        // Fjern fra saved for å unngå duplikater
        var savedIdx = saved.findIndex(function(item) { return item.id === data.id; });
        if (savedIdx !== -1) {
            saved.splice(savedIdx, 1);
            safeSetItem(SERVICE_STORAGE_KEY, JSON.stringify(saved));
        }

        // Update UI
        sessionStorage.setItem('firesafe_service_sent', '1');
        _serviceCurrentId = data.id;
        _serviceLastSavedData = getServiceFormDataSnapshot();
        document.getElementById('service-sent-banner').style.display = 'block';
        document.getElementById('btn-service-sent').style.display = 'none';
        showNotificationModal(t('marked_as_sent'), true);
        _lastLocalSaveTs = Date.now();
        closeServiceView();
        loadedForms = [];
        _showSavedFormsDirectly('service');

        enqueueUserDocMove('serviceArchive', 'serviceforms', data.id, data, 'Mark service as sent');
    } catch(e) {
        console.error('Mark service as sent error:', e);
    }
}

// Service export
function showServiceExportMenu() {
    var popup = document.getElementById('action-popup');
    document.getElementById('action-popup-title').textContent = t('export_title');
    var buttonsEl = document.getElementById('action-popup-buttons');
    var isSent = sessionStorage.getItem('firesafe_service_sent') === '1';
    var checkboxHtml = isSent ? '' :
        '<label style="display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;font-size:14px;padding:8px 0">' +
            '<input type="checkbox" id="service-export-mark-sent" style="width:22px;height:22px;accent-color:#E8501A;flex-shrink:0">' +
            t('export_and_mark_label') +
        '</label>';
    var shareIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    var canShare = !!(navigator.share && navigator.canShare);
    var shareBtnPDF = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doServiceSharePDF(document.getElementById(\'service-export-mark-sent\')?.checked); closeActionPopup()">' + shareIcon + ' PDF</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PDF</button>';
    var shareBtnPNG = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doServiceSharePNG(document.getElementById(\'service-export-mark-sent\')?.checked); closeActionPopup()">' + shareIcon + ' PNG</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PNG</button>';
    buttonsEl.innerHTML = checkboxHtml +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('export_download') + '</div>' +
        '<div class="confirm-modal-buttons" style="margin-bottom:12px">' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doServiceExportPDF(document.getElementById(\'service-export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PDF</button>' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doServiceExportPNG(document.getElementById(\'service-export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PNG</button>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('btn_share') + '</div>' +
        '<div class="confirm-modal-buttons">' +
            shareBtnPDF + shareBtnPNG +
        '</div>';
    popup.classList.add('active');
}

function buildServiceExportTable(cols) {
    var data = getServiceFormData();
    var container = document.getElementById('service-export-container');

    // Get ALL materials from settings (not just used ones)
    var allMats = typeof getMaterialPickerOptions === 'function'
        ? getMaterialPickerOptions(cachedMaterialOptions || [])
        : (cachedMaterialOptions || []);
    var matColumns = [];
    allMats.forEach(function(m) {
        var key = m.name || '';
        var label = m.displayName || key;
        if (typeof MATERIAL_KAPPE_LAUNCHER !== 'undefined' && key === MATERIAL_KAPPE_LAUNCHER) {
            if (typeof getKappeProducts === 'function' && getKappeProducts().length) {
                matColumns.push({ key: MATERIAL_ISOLATION_LAUNCHER, label: getMaterialIsolationLabel() });
            }
            if (typeof getKappeFastenerProducts === 'function') {
                getKappeFastenerProducts().forEach(function(product) {
                    matColumns.push({ key: product.name, label: product.name });
                });
            }
            return;
        }
        if (!label) {
            matColumns.push({ key: '', label: '' });
            return;
        }
        var n = label.charAt(0).toUpperCase() + label.slice(1);
        matColumns.push({
            key: key,
            label: formatKabelhylseSpec(n.replace(/ø(?=\d)/g, 'Ø'))
        });
    });

    var matCols = cols || 3;
    var matRowCount = Math.max(2, Math.ceil(matColumns.length / matCols));
    // Pad to fill all slots
    while (matColumns.length < matCols * matRowCount) matColumns.push({ key: '', label: '' });

    // Helper: check if material is a spec type
    function isSpecType(baseName) {
        var mat = allMats.find(function(m) { return m.name === baseName; });
        return mat && (mat.type === 'mansjett' || mat.type === 'brannpakning' || mat.type === 'kabelhylse');
    }

    // Helper: build cell value for a material in an entry
    function buildCellValue(baseName, entryMaterials) {
        if (!baseName) return '';
        var mats = entryMaterials || [];

        if (baseName === MATERIAL_ISOLATION_LAUNCHER) {
            var isolationLines = [];
            mats.forEach(function(m) {
                if (!m.name || !m.antall || !shouldGroupAsKappeIsolation(m)) return;
                var productLabel = formatKappeIsolationName(m.name, m.enhet, m.bredde, m.specMode);
                var lineText = escapeHtml(productLabel);
                // Plate-antall som primær metrikk (begge moduser). Fall tilbake til
                // antall+enhet hvis kalkuleringen mangler nødvendig data.
                var pc = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(m) : 0;
                if (pc > 0) {
                    var pcLabel = (typeof formatKappePlateCount === 'function') ? formatKappePlateCount(pc) : String(pc);
                    lineText += ' ' + pcLabel + ' ' + (pc === 1 ? 'plate' : 'plater');
                } else if (m.antall) {
                    var unit = m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source);
                    var unitLabel = unit === 'meter' ? ' meter' : ' ' + unit;
                    lineText += ' ' + formatRunningMeters(m.antall) + unitLabel;
                }
                isolationLines.push(lineText);
            });
            return isolationLines.join('<br>');
        }

        if (typeof getKappeFastenerProducts === 'function' && getKappeFastenerProducts().some(function(product) { return product.name === baseName; })) {
            var stiftLines = [];
            mats.forEach(function(m) {
                if (!m.name || !m.antall || !shouldGroupAsKappeStift(m) || m.name !== baseName) return;
                var stiftLabel = formatKappeStiftName(m.enhet, m.name);
                var unitLabel = m.quantityUnit || getKappeProductDefaultUnit(m.name) || 'stk';
                stiftLines.push(escapeHtml(stiftLabel) + ' ' + formatRunningMeters(m.antall) + ' ' + escapeHtml(unitLabel));
            });
            return stiftLines.join('<br>');
        }

        if (isSpecType(baseName)) {
            // Spec material: collect all derived entries matching this base
            var mat = allMats.find(function(m) { return m.name === baseName; });
            var hasLM = mat && (mat.type === 'mansjett' || mat.type === 'brannpakning');
            var lines = [];
            mats.forEach(function(m) {
                if (!m.name) return;
                // Direct meter entry on spec-base (Løpende) — render "Løpende · X meter"
                if (m.enhet === 'meter' && m.name.toLowerCase() === baseName.toLowerCase() && m.antall) {
                    lines.push('L\u00f8pende \u00b7 ' + formatRunningMeters(m.antall) + ' meter');
                    return;
                }
                if (m.name.toLowerCase().startsWith(baseName.toLowerCase() + ' ')) {
                    var pipeInfo = getRunningMeterInfo(m.name);
                    var pipes = parseFloat((m.antall || '').replace(',', '.'));
                    var spec = formatKabelhylseSpec(m.name.substring(baseName.length + 1).replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
                    if (hasLM && pipeInfo && !isNaN(pipes) && pipes > 0) {
                        // Mansjett/Brannpakning: show spec(N stk × M lag) · total meter
                        var lm = calculateRunningMeters(pipeInfo, pipes);
                        var lagMatchSv = spec.match(/^(.+?) \((\d+) lag\)$/);
                        var baseSpecSv = lagMatchSv ? lagMatchSv[1] : spec;
                        var roundsSv = lagMatchSv ? parseInt(lagMatchSv[2], 10) : 1;
                        var specWithStk = roundsSv > 1
                            ? baseSpecSv + ' (' + (m.antall || '').replace('.', ',') + ' stk \u00d7 ' + roundsSv + ' lag)'
                            : baseSpecSv + ' (' + (m.antall || '').replace('.', ',') + ' stk)';
                        lines.push(escapeHtml(formatDisplayForBreak(specWithStk)) + ' \u00b7 ' + formatRunningMeters(lm) + ' meter');
                    } else {
                        // Kabelhylse: show spec + antall + enhet on one line
                        var text = '';
                        if (spec) text += escapeHtml(formatDisplayForBreak(spec));
                        if (m.antall) text += ' ' + formatRunningMeters(m.antall) + ' stk';
                        lines.push(text.trim());
                    }
                }
            });
            return lines.join('<br>');
        } else {
            // Standard material: direct match by name
            var matched = [];
            mats.forEach(function(m) {
                if (m.name && m.name.toLowerCase() === baseName.toLowerCase() && m.antall) {
                    var variantSuffix = '';
                    var mEnhet = normalizeVariant(m.name, m.enhet || '').toLowerCase();
                    if (mEnhet && mEnhet !== 'stk' && mEnhet !== 'meter') {
                        variantSuffix = ' ' + mEnhet;
                    }
                    var stdUnit = m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source);
                    var stdUnitLabel = stdUnit === 'meter' ? ' meter' : ' ' + stdUnit;
                    matched.push(formatRunningMeters(m.antall) + stdUnitLabel + escapeHtml(variantSuffix));
                }
            });
            return matched.join('<br>');
        }
    }

    // Build one single table for the entire export
    var minSections = Math.max(4, data.entries.length);
    var totalRows = matRowCount * 2; // 4 rows per section
    var totalCols = 3 + matCols; // 3 info cols + 7 material cols

    var sigImgHtml = data.signatureImage
        ? '<img id="service-export-sig-img" src="' + data.signatureImage + '" style="height:20px;">'
        : '<img id="service-export-sig-img" style="display:none;height:20px;">';

    // Colgroup for consistent column widths
    var colgroup = '<colgroup>';
    colgroup += '<col style="width:8%">'; // Dato
    colgroup += '<col style="width:9%">'; // Prosjekt nr
    colgroup += '<col style="width:10%">'; // Prosjektnavn
    for (var c = 0; c < matCols; c++) {
        colgroup += '<col>';
    }
    colgroup += '</colgroup>';

    // Header: 2 rows — title rowspan=2, montør row 1, signatur row 2
    var headerRow =
        '<tr>' +
            '<td rowspan="2" colspan="3" class="se-title-cell"><strong>Lageruttak Servicebiler</strong></td>' +
            '<td class="se-montor-label" style="line-height:20px;">Navn montør:</td>' +
            '<td colspan="' + (matCols - 1) + '" class="se-montor-value" style="line-height:20px;">' + escapeHtml(stripEtternavn(data.montor)) + '</td>' +
        '</tr>' +
        '<tr>' +
            '<td class="se-montor-label">Signatur:</td>' +
            '<td colspan="' + (matCols - 1) + '" class="se-montor-value">' + sigImgHtml + '</td>' +
        '</tr>';

    var allRows = headerRow;

    var totalMatRows = matRowCount * 2; // header + data per group

    for (var s = 0; s < minSections; s++) {
        var entry = data.entries[s] || {};
        var valueRowspan = totalMatRows - 1; // all rows except the label row

        // First material group: info labels + material headers
        allRows += '<tr>' +
            '<td class="se-info-label-cell">Dato:</td>' +
            '<td class="se-info-label-cell">Prosjekt nr:</td>' +
            '<td class="se-info-label-cell">Prosjektnavn</td>';
        for (var c = 0; c < matCols; c++) {
            allRows += '<th>' + escapeHtml(matColumns[c].label || '') + '</th>';
        }
        allRows += '</tr>';

        // First material group: info values (rowspan covers remaining rows) + material data
        allRows += '<tr>' +
            '<td rowspan="' + valueRowspan + '" class="se-info-value-cell">' + escapeHtml(entry.dato || '') + '</td>' +
            '<td rowspan="' + valueRowspan + '" class="se-info-value-cell">' + escapeHtml(entry.prosjektnr || '') + '</td>' +
            '<td rowspan="' + valueRowspan + '" class="se-info-value-cell">' + escapeHtml(entry.prosjektnavn || '') + '</td>';
        for (var c = 0; c < matCols; c++) {
            var val = buildCellValue(matColumns[c].key, entry.materials);
            allRows += '<td' + (val ? ' class="se-has-value"' : '') + '>' + val + '</td>';
        }
        allRows += '</tr>';

        // Additional material groups (2nd, 3rd, etc.)
        for (var mr = 1; mr < matRowCount; mr++) {
            // Header row
            allRows += '<tr>';
            for (var c = 0; c < matCols; c++) {
                var idx = mr * matCols + c;
                allRows += '<th>' + escapeHtml(matColumns[idx].label || '') + '</th>';
            }
            allRows += '</tr>';

            // Data row
            allRows += '<tr>';
            for (var c = 0; c < matCols; c++) {
                var idx = mr * matCols + c;
                var val = buildCellValue(matColumns[idx].key, entry.materials);
                allRows += '<td' + (val ? ' class="se-has-value"' : '') + '>' + val + '</td>';
            }
            allRows += '</tr>';
        }

        // Separator row between/after sections
        allRows += '<tr class="se-separator"><td colspan="' + (3 + matCols) + '"></td></tr>';
    }

    container.innerHTML =
        '<div class="service-export-page">' +
            '<table class="service-export-table">' +
                colgroup + allRows +
            '</table>' +
        '</div>';

    return container;
}

function openServicePreview() {
    var container = buildServiceExportTable(7);
    container.style.display = 'block';
    container.style.width = '1250px';
    container.style.overflow = 'hidden';

    var scroll = document.getElementById('preview-scroll');
    scroll.appendChild(container);

    window._servicePreviewActive = true;
    window._previewSavedScroll = _saveScrollPositions();
    document.getElementById('preview-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('preview-active');

    // Set header state based on whether service signature exists
    var hasSig = !!document.getElementById('service-signatur').value;
    updatePreviewHeaderState(hasSig);

    requestAnimationFrame(function() {
        updateServicePreviewScale();
        // Init pinch-zoom on mobile (same as ordreseddel preview)
        var baseScale = Math.min(scroll.clientWidth / 1250, 1);
        if (baseScale < 1) {
            initPreviewPinchZoom(scroll, container, baseScale);
        }
    });

    window._previewResizeHandler = _onServicePreviewViewportChange;
    window.addEventListener('resize', window._previewResizeHandler);
    window.addEventListener('orientationchange', window._previewResizeHandler);
}

// Re-skalerer og re-binder pinch-zoom ved viewport-endring (resize/orientationchange).
// 200ms delay lar browser-layout stabilisere etter rotasjon.
function _onServicePreviewViewportChange() {
    clearTimeout(window._svcPreviewOrientTimer);
    window._svcPreviewOrientTimer = setTimeout(function() {
        updateServicePreviewScale();
        cleanupPreviewPinchZoom();
        var scroll = document.getElementById('preview-scroll');
        var container = document.getElementById('service-export-container');
        if (!scroll || !container) return;
        var baseScale = Math.min(scroll.clientWidth / 1250, 1);
        if (baseScale < 1) {
            initPreviewPinchZoom(scroll, container, baseScale);
        }
    }, 200);
}

function updateServicePreviewScale() {
    var overlay = document.getElementById('preview-overlay');
    if (!overlay || !overlay.classList.contains('active')) return;

    var container = document.getElementById('service-export-container');
    var scroll = document.getElementById('preview-scroll');
    if (!container || !scroll) return;

    // Wipe any lingering inline styles
    container.style.transform = '';
    container.style.transformOrigin = '';
    container.style.marginLeft = '';
    container.style.marginRight = '';
    container.style.marginBottom = '';

    var header = document.querySelector('.preview-overlay-header');
    var cs = getComputedStyle(scroll);
    var padLR = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var availWidth = scroll.clientWidth - padLR;
    var formHeight = container.offsetHeight;
    // PC (≥1400px med mus): cap til 800px for å matche resten av appens bredde.
    // Mobil/nettbrett: full bredde for konsistens.
    var isDesktop = window.matchMedia('(min-width: 1400px) and (hover: hover) and (pointer: fine)').matches;
    var maxRenderedWidth = isDesktop ? 800 : availWidth;
    var scale = maxRenderedWidth / 1250;

    var renderedWidth = 1250 * scale;
    var translateX = Math.max(0, (availWidth - renderedWidth) / 2);
    container.style.transformOrigin = 'top left';
    container.style.transform = 'translate(' + translateX + 'px, 0) scale(' + scale + ')';
    container.style.marginBottom = (-(formHeight * (1 - scale))) + 'px';
    container.style.marginRight = -(1250 - renderedWidth - translateX) + 'px';
    container.style.marginLeft = '0';
    if (header) {
        header.style.maxWidth = renderedWidth + 'px';
        header.style.margin = '0 auto';
    }

    window._previewBaseScale = scale;
    window._previewCurrentScale = scale;
}

async function renderServiceToCanvas() {
    var container = buildServiceExportTable(7);
    container.style.display = 'block';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '1250px';
    container.style.visibility = 'hidden';
    container.style.zIndex = '-1';

    await new Promise(function(resolve) { requestAnimationFrame(function() { requestAnimationFrame(resolve); }); });
    container.style.visibility = 'visible';
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '';

    var canvas = await html2canvas(container, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    });

    container.style.display = 'none';
    container.style.position = '';
    container.style.left = '';
    container.style.width = '';
    container.style.visibility = '';
    container.style.zIndex = '';

    return canvas;
}

function getServiceExportFilename(ext) {
    var data = (typeof getServiceFormData === 'function') ? getServiceFormData() : {};
    return _filenameForForm(data, 0, 'service', ext);
}

async function doServiceExportPDF(markSent) {
    if (!validateServiceRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderServiceToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
        pdf.save(getServiceExportFilename('pdf'));
        if (markSent) markServiceAsSent();
    } catch(error) {
        showNotificationModal(t('export_pdf_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doServiceExportPNG(markSent) {
    if (!validateServiceRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderServiceToCanvas();
        var link = document.createElement('a');
        link.download = getServiceExportFilename('png');
        link.href = canvas.toDataURL('image/png');
        link.click();
        if (markSent) markServiceAsSent();
    } catch(error) {
        showNotificationModal(t('export_png_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doServiceSharePDF(markSent) {
    if (!validateServiceRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderServiceToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
        var blob = pdf.output('blob');
        var file = new File([blob], getServiceExportFilename('pdf'), { type: 'application/pdf' });
        loading.classList.remove('active');
        var result = await _safeShare([file]);
        if (result === 'shared' && markSent) markServiceAsSent();
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doServiceSharePNG(markSent) {
    if (!validateServiceRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderServiceToCanvas();
        var dataUrl = canvas.toDataURL('image/png');
        var res = await fetch(dataUrl);
        var blob = await res.blob();
        var file = new File([blob], getServiceExportFilename('png'), { type: 'image/png' });
        loading.classList.remove('active');
        var result = await _safeShare([file]);
        if (result === 'shared' && markSent) markServiceAsSent();
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

// Background click handler removed - saved-modal is now a view, not an overlay

// Event delegation for saved-list items
document.getElementById('saved-list').addEventListener('click', function(e) {
    const savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    // Get form data directly from the element
    const formData = savedItem._formData;
    if (!formData) return;

    // Select mode: tap toggles selection, ignore buttons
    if (_selectMode) {
        e.preventDefault();
        e.stopPropagation();
        var idx = parseInt(savedItem.dataset.index, 10);
        if (!isNaN(idx)) toggleFormSelection(idx, savedItem);
        return;
    }

    // Check if click was on a button
    const btn = e.target.closest('button');
    if (btn) {
        e.stopPropagation();
        if (btn.classList.contains('disabled')) return;
        if (btn.classList.contains('clipboard')) {
            var nr = savedItem._formData.ordreseddelNr || '';
            if (nr) {
                navigator.clipboard.writeText(nr).then(function() {
                    showNotificationModal(t('copied_to_clipboard'), true);
                }).catch(function() {
                    showNotificationModal(t('copied_to_clipboard'), true);
                });
            }
        } else if (btn.classList.contains('copy')) {
            showConfirmModal(t('duplicate_confirm'), function() {
                duplicateFormDirect(savedItem._formData);
            }, t('duplicate_btn'));
        } else if (btn.classList.contains('delete')) {
            deleteFormDirect(savedItem._formData);
        }
        return;
    }

    // Click on item row - load the form
    loadFormDirect(savedItem._formData);
});

// Event delegation for template picker overlay

// Event delegation for template picker overlay
document.getElementById('template-picker-list').addEventListener('click', function(e) {
    var savedItem = e.target.closest('.saved-item');
    if (!savedItem || !savedItem._formData) return;
    _applyTemplateToForm(savedItem._formData);
});

// Event delegation for service-list items
document.getElementById('service-list').addEventListener('click', function(e) {
    var savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    var formData = savedItem._formData;
    if (!formData) return;

    if (_selectMode) {
        e.preventDefault();
        e.stopPropagation();
        var idx = parseInt(savedItem.dataset.index, 10);
        if (!isNaN(idx)) toggleFormSelection(idx, savedItem);
        return;
    }

    var btn = e.target.closest('button');
    if (btn) {
        if (btn.classList.contains('disabled')) return;
        e.stopPropagation();
        if (btn.classList.contains('clipboard')) {
            var nr = formData.ordreseddelNr || '';
            if (nr) {
                navigator.clipboard.writeText(nr).then(function() {
                    showNotificationModal(t('copied_to_clipboard'), true);
                }).catch(function() {
                    showNotificationModal(t('copied_to_clipboard'), true);
                });
            }
        } else if (btn.classList.contains('delete')) {
            deleteServiceForm(formData);
        } else if (btn.classList.contains('copy')) {
            showConfirmModal(t('duplicate_confirm'), function() {
                duplicateServiceForm(formData);
            }, t('duplicate_btn'));
        }
        return;
    }

    // Click on item row - load the service form
    loadServiceFormDirect(formData);
});

// Background click handler removed - template-modal is now a view, not an overlay

// Sync forms when typing (with debounced sessionStorage save)
var sessionSaveTimeout = null;
function debouncedSessionSave() {
    clearTimeout(sessionSaveTimeout);
    sessionSaveTimeout = setTimeout(function() {
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    }, 1500);
}

document.getElementById('mobile-form').addEventListener('input', function() {
    syncMobileToOriginal();
    debouncedSessionSave();
});

document.getElementById('form-container').addEventListener('input', function() {
    syncOriginalToMobile();
    debouncedSessionSave();
});

// Debounced session save for service form
var serviceSessionSaveTimeout = null;
function debouncedServiceSessionSave() {
    clearTimeout(serviceSessionSaveTimeout);
    serviceSessionSaveTimeout = setTimeout(function() {
        if (document.body.classList.contains('service-view-open')) {
            sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
        }
    }, 1500);
}

document.getElementById('service-form').addEventListener('input', function() {
    debouncedServiceSessionSave();
});

document.getElementById('service-signature-preview').addEventListener('click', function() {
    signatureTarget = 'service';
    openSignatureOverlay();
});

document.getElementById('mobile-signature-preview').addEventListener('click', function() {
    signatureTarget = 'form';
    openSignatureOverlay();
});

document.addEventListener('DOMContentLoaded', function() {
    // Set toolbar height CSS variable (replaces hardcoded 60px).
    // Må re-syncs når toolbar's faktiske størrelse endres etter initial render —
    // f.eks. når fonter laster, safe-area-inset-bottom blir applikert (iOS),
    // eller orientering/viewport endres. Bug-symptom uten ResizeObserver: noen
    // ganger blir form-actions (Vis/Eksport/Ferdig) skjult bak toolbar fordi
    // --toolbar-h ble satt for tidlig med feil verdi.
    var toolbar = document.querySelector('.toolbar');
    function syncToolbarHeight() {
        if (toolbar) {
            document.documentElement.style.setProperty('--toolbar-h', toolbar.offsetHeight + 'px');
        }
    }
    syncToolbarHeight();
    // Catch any toolbar-size endring (font-load, safe-area-inset, content-endring)
    if (toolbar && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncToolbarHeight).observe(toolbar);
    }
    // Backup ved full sideinnlasting (fonter ferdig, alt rendret)
    window.addEventListener('load', syncToolbarHeight);
    window.addEventListener('resize', syncToolbarHeight);
    window.addEventListener('orientationchange', function() { setTimeout(syncToolbarHeight, 200); });

    // Init date inputs
    initDateInput(document.getElementById('mobile-signering-dato'));

    // PWA pull-to-refresh workaround: Force layout recalculation
    setTimeout(function() {
        void document.body.offsetHeight;
    }, 50);

    const current = sessionStorage.getItem('firesafe_current');
    if (current) {
        try {
            const data = JSON.parse(current);
            setFormData(data);
        } catch (e) {}
    }
    // Tøm kundens underskrift ved oppstart (session-spesifikk — må signeres på nytt).
    // Signering-dato: alltid dagens for draft (system-styrt), bevares for sendt.
    // Uke: settes bare hvis dette er en HELT FRISK start (ingen session-data).
    // Hvis vi gjenoppretter en draft fra forrige økt, bevares lagret uke
    // (uka representerer NÅR jobben ble utført, ikke når skjemaet ble åpnet).
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    const _wasSentOnStartup = sessionStorage.getItem('firesafe_current_sent') === '1';
    if (!_wasSentOnStartup) {
        _setSigneringDatoToday();
    }
    if (!current) {
        // Helt frisk start (ingen lagret session) → nytt skjema får dagens uke.
        _setUkeToToday();
    }

    // Sett lastSavedData ETTER alle init-endringer (signering-dato, underskrift)
    if (current) {
        lastSavedData = getFormDataSnapshot();
    }

    // Initialize orders if empty (first load without session data)
    const ordersContainer = document.getElementById('mobile-orders');
    if (ordersContainer && ordersContainer.children.length === 0) {
        ordersContainer.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
        updateOrderDeleteStates();
    }

    // Apply saved language
    applyTranslations();

    // === UNIFIED TASTATUR-HÅNDTERING ===
    //
    // Med viewport-meta `interactive-widget=resizes-visual`:
    // - Layout viewport (window.innerHeight) forblir full skjerm når tastatur åpnes
    // - Visual viewport (window.visualViewport) krymper til synlig område over tastaturet
    // - position:fixed-element ankres mot layout viewport og dekker fortsatt hele skjermen
    //
    // applyKeyboardLayout() er den ENESTE JS-eieren av tastatur-respons.
    // To-lags arkitektur:
    //
    // LAG 1 (CSS-drevet via body.keyboard-focus-klasse):
    //   - Form-views (view-form, service-view, kappe-view): position: static,
    //     overflow: visible, body scroller naturlig, toolbar i flow på slutten
    //   - Sticky-headers (#form-header, #service-header) holder seg på topp
    //   - body padding-bottom: 0 (toolbar ikke fixed lenger)
    //   - .confirm-modal padding-bottom: 0
    //
    // LAG 2 (JS — for elementer som ikke kan flyte naturlig):
    //   - Modal-views (saved-modal, template-modal, settings-modal):
    //     krympes til synlig viewport (fixed-positioned, height: vv.height,
    //     min-height: 0). Toolbar reparentes til aktiv modal-body så den
    //     scroller med listeitems. MutationObserver-vakt re-appender toolbar
    //     hvis innerHTML-replacements ødelegger den.
    //   - Fullscreen-overlays (#picker-overlay etc.): krympes til synlig
    //     viewport (top: vv.offsetTop, height: vv.height) så scroll i intern
    //     liste fungerer (ellers mister browseren touch-events bak tastatur).
    //   - Popups (.confirm-modal-content, .spec-popup-sheet,
    //     .fakturaadresse-popup-sheet): piksel-cap på max-height +
    //     translateY-ankring rett over tastatur.
    //
    // Funksjonen er idempotent (state-memo skip'er hvis logisk state uendret)
    // og trygg å kalle gjentatte ganger.
    //
    // Robusthet — fem trigger-mekanismer:
    //   1. visualViewport.resize (umiddelbar apply + 250ms settle for å
    //      fange final vv-verdier etter tastatur-animasjon/URL-bar-settle)
    //   2. document.body subtree MutationObserver — class-endringer på
    //      popup-backdrops OG .view (view-bytter), pluss childList for
    //      dynamisk innsatte popups
    //   3. ResizeObserver per aktiv popup-content (re-kalkulerer translate
    //      når content vokser/krymper)
    //   4. focusin/focusout — filtrert til kun text-inputs/textarea/
    //      contenteditable så scroll-momentum ikke avbrytes ved tap på
    //      ikke-keyboard-åpnende elementer (knapper, checkboxer)
    //   5. Initial scheduleApply() ved DOMContentLoaded
    //
    // visualViewport.scroll lyttes IKKE på — fyrer per frame under scroll
    // når URL-bar beveger seg, ville avbryte momentum. Final vv-verdier
    // hentes via settle-timer i stedet.
    //
    // Tab-switch i modal-views (switchHentTab etc.) endrer modal-body
    // display via inline-style, ikke class. Disse må eksplisitt kalle
    // window.applyKeyboardLayout() for å trigge re-evaluering.
    //
    // requestAnimationFrame-debouncing: alle triggers ruter gjennom scheduleApply()
    // som garanterer maks ÉN apply per frame, uavhengig av hvor mange events fyrer.
    var POPUP_BACKDROP_SELECTOR = '.confirm-modal, .spec-popup-backdrop, .fakturaadresse-popup-backdrop';
    var POPUP_CONTENT_SELECTOR = '.confirm-modal-content, .spec-popup-sheet, .fakturaadresse-popup-sheet';

    // Bytter viewport-meta sin interactive-widget mellom resizes-visual
    // (normalt, best for skjema-scroll til fokusert felt) og overlays-content
    // (mens popup er åpen — eliminerer visual-viewport-panorering som ellers
    // lar Chrome PWA scrolle skjemaet bak popupen. Se applyKeyboardLayout-
    // kommentaren for detaljer). Idempotent diff-set — ingen reflow når
    // uendret.
    function _syncViewportMetaForPopup(popupActive) {
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        var cur = meta.getAttribute('content') || '';
        var target = popupActive ? 'overlays-content' : 'resizes-visual';
        var other = popupActive ? 'resizes-visual' : 'overlays-content';
        if (cur.indexOf('interactive-widget=' + target) !== -1) return;
        var next = cur.indexOf('interactive-widget=' + other) !== -1
            ? cur.replace('interactive-widget=' + other, 'interactive-widget=' + target)
            : (cur.replace(/,?\s*interactive-widget=[^,]*/g, '') + ', interactive-widget=' + target);
        meta.setAttribute('content', next);
    }

    // === VirtualKeyboard API: eksakt tastatur-geometri ===
    // Chromium (Android Chrome PWA, Edge): aktivering av overlaysContent=true
    // gjør at browseren rapporterer faktisk tastatur-rect via boundingRect og
    // fyrer geometrychange ved endringer. Erstatter %-gjetning med målinger
    // som er korrekte uansett tastatur (Gboard/Samsung/SwiftKey/numerisk/
    // emoji-bar/landskap). Ikke-Chromium-browsere (iOS Safari, Firefox)
    // mangler API → faller naturlig tilbake til visualViewport-krymping.
    var _HAS_VKBD_API = !!(typeof navigator !== 'undefined' && navigator.virtualKeyboard
        && typeof navigator.virtualKeyboard.overlaysContent === 'boolean');
    if (_HAS_VKBD_API) {
        try {
            navigator.virtualKeyboard.overlaysContent = true;
            navigator.virtualKeyboard.addEventListener('geometrychange', function() {
                var br = navigator.virtualKeyboard.boundingRect;
                if (br && br.height > 0) {
                    // Konfirmerer at vi har pålitelig tastatur-signal → form-
                    // view-paths som er gated på dette flagget aktiveres.
                    viewportKeyboardDetectionConfirmed = true;
                }
                scheduleForcedApply();
            });
        } catch (e) { /* feature ikke støttet eller blokkert — ignorer */ }
    }

    // Returnerer tastaturets topp-kant i layout-viewport-koordinater, eller
    // null hvis ingen pålitelig måling er tilgjengelig. To-lags fallback:
    //   1) VirtualKeyboard API (Chromium): bruk br.HEIGHT for å regne topp.
    //      Chrome's boundingRect inkluderer ofte IKKE accessory-baren
    //      (GIF/sticker/emoji-strip over keys). Vi trekker en buffer.
    //   2) visualViewport-krymp (iOS Safari, Firefox): inkluderer alt —
    //      ingen buffer nødvendig.
    //   3) null → caller skip'er evt. cap/scroll.
    // Bufferen er adaptiv basert på fokus-feltets inputMode/type:
    //   - Numerisk/tlf/dato (tastatur = siffer-grid, ingen accessory) → 8px.
    //   - Tekst/email/etc. (QWERTY-tastatur har typisk accessory-bar) → 36px.
    // Web-plattformen eksponerer ikke faktisk accessory-bar-tilstedeværelse,
    // så dette er en heuristikk per tastatur-type. Mer pålitelig enn én fast
    // verdi, ikke perfekt for alle eksotiske tastatur-konfigurasjoner.
    function _accessoryBufferForActiveInput() {
        var ae = document.activeElement;
        if (!ae) return 36;
        var im = ((ae.inputMode || '') + '').toLowerCase();
        var t = ((ae.type || '') + '').toLowerCase();
        if (im === 'numeric' || im === 'decimal' || im === 'tel'
            || t === 'number' || t === 'tel') {
            return 8;
        }
        if (t === 'date' || t === 'time' || t === 'datetime-local'
            || t === 'month' || t === 'week') {
            return 8;
        }
        return 36;
    }
    function _getKeyboardTop() {
        var innerH = window.innerHeight || 0;
        if (!innerH) return null;
        if (_HAS_VKBD_API && navigator.virtualKeyboard.boundingRect) {
            var br = navigator.virtualKeyboard.boundingRect;
            if (br && br.height > 0 && br.height < innerH * 0.85) {
                return innerH - br.height - _accessoryBufferForActiveInput();
            }
        }
        if (window.visualViewport) {
            var vv = window.visualViewport;
            var shrunk = (innerH - vv.height - vv.offsetTop);
            if (shrunk > 50 && shrunk < innerH * 0.85) {
                return vv.offsetTop + vv.height;
            }
        }
        return null;
    }

    // Felles toolbar-regel:
    // - Tastatur lukket: toolbar eies av body og er fixed i bunn.
    // - Tastatur åpent: toolbar flyttes til aktiv scroll-host som siste element.
    //   Kort innhold presses ned til tastaturet via .toolbar-keyboard-host;
    //   langt innhold scroller naturlig ned til toolbar.
    // Denne regelen gjelder generelt for alle views nedenfor, ikke som
    // side-spesifikk spesialhåndtering.
    var FORM_VIEW_IDS = ['view-form', 'service-view', 'kappe-view'];
    // Modal-views: krympes ved tastatur. Toolbar reparenteres til aktiv
    // scrollflate slik at den blir nederste scroll-element, ikke fixed over
    // tastaturet.
    var MODAL_VIEW_IDS = ['saved-modal', 'template-modal', 'settings-modal'];
    var MODAL_TOOLBAR_HOST_IDS = ['saved-modal', 'template-modal', 'settings-modal'];
    // Fullscreen-overlays (height:100%/100dvh) som strekker seg bak tastaturet.
    // Må krympes til synlig viewport ellers blir scroll i intern liste broken
    // (browseren mister touch-events for området bak tastaturet).
    var FULLSCREEN_OVERLAY_IDS = ['picker-overlay', 'kappe-product-picker-overlay', 'template-picker-overlay'];
    var KEYBOARD_THRESHOLD = 100;
    var KEYBOARD_MARGIN = 16;

    // ResizeObservers per popup-content — kobles inn når popup blir aktiv,
    // kobles ut når popup deaktiveres. Map for iteration + lookup.
    var contentResizeObservers = new Map();
    var rafScheduled = false;
    // State-memoisering: skip apply hvis tilstand er materielt uendret.
    // KRITISK for scroll-momentum: under scroll kan URL-bar bevege seg og
    // fyre vv-events på hver frame. Uten memoisering ville hver event
    // forårsake reflow midt i scroll-momentum og avbryte det.
    var lastAppliedState = null;
    // ResizeObserver må kunne bypasse dedup når content-størrelse endres
    // (ellers vil dynamisk content-vekst ikke trigge re-kalkulering av transform).
    var forceNextApply = false;
    function scheduleForcedApply() { forceNextApply = true; scheduleApply(); }

    // Hysteresis på keyboardOpen for å unngå flicker. Hvis input kortvarig
    // mister fokus (f.eks. browser auto-scroll-into-view under scroll, eller
    // mid-momentum focus-justering), kan vv.height kortvarig vise "lukket"
    // tastatur. Uten hysteresis ville toolbar-reparenting skje to ganger
    // (lukket → åpen igjen) og forstyrre scroll/UI.
    // - Åpning: settes umiddelbart når detektert
    // - Lukking: forsinkes 400ms — må være vedvarende lukket
    var stableKeyboardOpen = false;
    var keyboardCloseTimer = null;
    var keyboardBaselineInnerHeight = window.innerHeight || 0;
    var formKeyboardMode = false;
    var formKeyboardSawViewportShrink = false;
    var lastFormKeyboardTarget = null;
    var maxObservedViewportHeight = window.innerHeight || 0;
    var IS_TOUCH_DEVICE = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
        || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    // Sporer hvilke keyboard-målinger som faktisk fungerer på enheten.
    // Noen Android/PWA-varianter krymper visualViewport, andre krymper
    // window.innerHeight. Fokus brukes bare som fallback før en målemetode
    // har bekreftet at den kan se keyboardet.
    var viewportKeyboardDetectionConfirmed = false;
    var layoutKeyboardDetectionConfirmed = false;
    function _isKeyboardOpenByViewport() {
        if (!window.visualViewport) return false;
        var vv = window.visualViewport;
        return (window.innerHeight - vv.height - vv.offsetTop) > KEYBOARD_THRESHOLD;
    }
    function _isKeyboardOpenByLayoutResize() {
        return (keyboardBaselineInnerHeight - window.innerHeight) > KEYBOARD_THRESHOLD;
    }
    function isFormKeyboardTarget(el) {
        return !!(
            el &&
            el.nodeType === 1 &&
            isKeyboardOpeningElement(el) &&
            el.closest &&
            el.closest('#view-form, #service-view, #kappe-view')
        );
    }
    function _hasFocusedFormKeyboardElement() {
        return !!(IS_TOUCH_DEVICE && isFormKeyboardTarget(document.activeElement));
    }
    function _isKeyboardOpenRaw() {
        var viewportOpen = _isKeyboardOpenByViewport();
        if (viewportOpen) {
            viewportKeyboardDetectionConfirmed = true;
            return true;
        }

        var layoutOpen = _isKeyboardOpenByLayoutResize();
        if (layoutOpen) {
            layoutKeyboardDetectionConfirmed = true;
            return true;
        }

        if (viewportKeyboardDetectionConfirmed || layoutKeyboardDetectionConfirmed) {
            return false;
        }

        // visualViewport-API er tilgjengelig på alle moderne nettlesere
        // (iOS Safari, Android Chrome, desktop). Hvis det rapporterer ingen
        // høyde-reduksjon (sjekkene over returnerte false), har vi konkret
        // signal: tastatur er IKKE åpent. Focus-fallback brukes da ikke —
        // den var ment som bridge før viewport-deteksjon kunne bekrefte,
        // men på desktop / hybrid-enheter (touchpoints uten faktisk
        // tastatur) ville fallback'en låse seg permanent og reparentere
        // toolbar til form-view.
        if (window.visualViewport) return false;

        // Eldre nettlesere uten visualViewport-API: focus-heuristikk som
        // beste tilgjengelige signal.
        if (_hasFocusedFormKeyboardElement()) return true;
        return false;
    }
    function updateKeyboardState() {
        var rawOpen = _isKeyboardOpenRaw();
        if (rawOpen) {
            if (keyboardCloseTimer) { clearTimeout(keyboardCloseTimer); keyboardCloseTimer = null; }
            stableKeyboardOpen = true;
        } else if (stableKeyboardOpen && !keyboardCloseTimer) {
            keyboardCloseTimer = setTimeout(function() {
                keyboardCloseTimer = null;
                // Re-sjekk ved utløp: tastatur kan ha kommet tilbake
                if (_isKeyboardOpenRaw()) return;
                stableKeyboardOpen = false;
                scheduleForcedApply();
            }, 400);
        }
        return stableKeyboardOpen;
    }

    function syncKeyboardFocusClass(focusedEl, keyboardOpen) {
        var shouldUseFormKeyboardLayout = !!(formKeyboardMode || (IS_TOUCH_DEVICE && keyboardOpen && isFormKeyboardTarget(focusedEl)));
        document.body.classList.toggle('keyboard-focus', shouldUseFormKeyboardLayout);
        var toolbar = document.querySelector('.toolbar');
        if (toolbar) toolbar.classList.toggle('toolbar--keyboard-form', shouldUseFormKeyboardLayout);
    }

    function getVisibleViewportHeight() {
        if (!window.visualViewport) return window.innerHeight || 0;
        return window.visualViewport.offsetTop + window.visualViewport.height;
    }

    function trackViewportSize() {
        var visibleHeight = getVisibleViewportHeight();
        maxObservedViewportHeight = Math.max(maxObservedViewportHeight || 0, visibleHeight || 0, window.innerHeight || 0);
        if (formKeyboardMode && visibleHeight && maxObservedViewportHeight && (maxObservedViewportHeight - visibleHeight) > KEYBOARD_THRESHOLD) {
            formKeyboardSawViewportShrink = true;
        }
    }

    function placeToolbarForFormKeyboard(active, focusedEl) {
        var toolbar = document.querySelector('.toolbar');
        if (!toolbar) return;

        // REDESIGN: toolbaren reparenteres ALDRI for skjema-views. Den blir
        // værende i <body> som siste element. Når skjemaet skrives i (CSS:
        // body.kbd-editing / keyboard-focus) blir den aktive form-viewen
        // position:static og toolbaren position:static → den havner naturlig
        // som siste element i side-scrollen (scroll helt ned for å se den).
        // Ingen flex-host / margin-top:auto-pinning som dyttet den over
        // tastaturet. Her holder vi bare body-klassene + rydder defensivt.
        if (active) {
            if (isFormKeyboardTarget(focusedEl)) {
                lastFormKeyboardTarget = focusedEl;
            }
            document.body.classList.add('keyboard-open', 'keyboard-focus');
            return;
        }

        toolbar.classList.remove('toolbar--keyboard-form');
        clearKeyboardToolbarHosts();
        if (toolbar.parentNode !== document.body) {
            document.body.appendChild(toolbar);
        }
        document.body.classList.remove('keyboard-open', 'keyboard-focus');
    }

    function setFormKeyboardMode(active, focusedEl) {
        if (active) {
            formKeyboardMode = true;
            placeToolbarForFormKeyboard(true, focusedEl);
            return;
        }

        if (!formKeyboardMode) return;
        formKeyboardMode = false;
        formKeyboardSawViewportShrink = false;
        lastFormKeyboardTarget = null;
        placeToolbarForFormKeyboard(false);
        forceNextApply = true;
    }

    function closeFormKeyboardModeIfViewportRestored() {
        if (!formKeyboardMode) return;
        trackViewportSize();
        var visibleHeight = getVisibleViewportHeight();
        // Hvis vi tidligere så viewport-krymp: standard cleanup når full høyde er tilbake.
        if (formKeyboardSawViewportShrink) {
            if (visibleHeight && maxObservedViewportHeight && visibleHeight >= maxObservedViewportHeight - KEYBOARD_THRESHOLD) {
                setFormKeyboardMode(false);
            }
            return;
        }
        // Hvis vi aldri så viewport-krymp (formKeyboardMode kan ha blitt satt
        // av tidligere focus-fallback før guard ble innført, eller på en
        // hybrid-enhet uten faktisk tastatur), og viewport viser full høyde:
        // tving cleanup — det er ikke noe ekte tastatur som rettferdiggjør
        // formKeyboardMode.
        if (window.visualViewport) {
            var vv = window.visualViewport;
            var noShrink = (window.innerHeight - vv.height - vv.offsetTop) < KEYBOARD_THRESHOLD;
            if (noShrink) setFormKeyboardMode(false);
        }
    }

    function settleClosedKeyboardFromMetrics() {
        closeFormKeyboardModeIfViewportRestored();
        if (formKeyboardMode) return;
        if (!(viewportKeyboardDetectionConfirmed || layoutKeyboardDetectionConfirmed)) return;
        if (_isKeyboardOpenByViewport() || _isKeyboardOpenByLayoutResize()) return;
        if (keyboardCloseTimer) {
            clearTimeout(keyboardCloseTimer);
            keyboardCloseTimer = null;
        }
        stableKeyboardOpen = false;
        keyboardBaselineInnerHeight = Math.max(keyboardBaselineInnerHeight || 0, window.innerHeight || 0);
        document.body.classList.remove('keyboard-open', 'keyboard-focus');
        var toolbar = document.querySelector('.toolbar');
        if (toolbar) toolbar.classList.remove('toolbar--keyboard-form');
        clearKeyboardToolbarHosts();
        forceNextApply = true;
    }

    function scheduleApply() {
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(function() {
            rafScheduled = false;
            applyKeyboardLayout();
        });
    }

    // Toolbar-guard: når toolbar er reparent'et inn i en modal-body, kan
    // innerHTML-replacements (fra renderSavedFormsList etc.) ødelegge den.
    // Denne MutationObserveren overvåker modal-body for childList-endringer
    // og re-appender toolbar hvis den blir fjernet. Toolbar-elementet beholdes
    // i minne via referanse (selv om det fjernes fra DOM via innerHTML), så
    // re-append fungerer.
    var toolbarGuardObserver = null;
    var guardedHost = null;
    function startToolbarGuard(host, toolbar) {
        stopToolbarGuard();
        guardedHost = host;
        toolbarGuardObserver = new MutationObserver(function() {
            if (guardedHost && !guardedHost.contains(toolbar)) {
                guardedHost.appendChild(toolbar);
            }
        });
        toolbarGuardObserver.observe(host, { childList: true });
    }
    function stopToolbarGuard() {
        if (toolbarGuardObserver) {
            toolbarGuardObserver.disconnect();
            toolbarGuardObserver = null;
        }
        guardedHost = null;
    }

    function clearKeyboardToolbarHosts(exceptHost) {
        document.querySelectorAll('.toolbar-keyboard-host').forEach(function(host) {
            if (host === exceptHost) return;
            host.classList.remove('toolbar-keyboard-host');
            host.style.minHeight = '';
        });
    }

    function prepareKeyboardToolbarHost(host) {
        if (!host) return;
        clearKeyboardToolbarHosts(host);
        host.classList.add('toolbar-keyboard-host');
        var rect = host.getBoundingClientRect();
        var available = Math.max(0, getVisibleViewportHeight() - rect.top);
        if (available) host.style.minHeight = available + 'px';
    }


    // Finn elementet toolbar skal appendes til når tastatur er åpent.
    // Returnerer null hvis toolbar skal være i body (default — fixed bottom).
    function findToolbarScrollHost(keyboardOpen, activeId) {
        if (!keyboardOpen) return null;
        if (document.body.classList.contains('servicebil-inntak-mode')) {
            var picker = document.getElementById('picker-overlay');
            if (picker && picker.classList.contains('active')) {
                var list = picker.querySelector('.picker-overlay-list');
                if (list) return list;
            }
        }
        if (MODAL_TOOLBAR_HOST_IDS.indexOf(activeId) !== -1) {
            var modalView = document.getElementById(activeId);
            if (modalView) {
                var bodies = modalView.querySelectorAll('.modal-body');
                for (var i = 0; i < bodies.length; i++) {
                    if (bodies[i].offsetParent !== null) return bodies[i];
                }
            }
        }
        return null;
    }

    function findFormToolbarHost(focused) {
        focused = focused || document.activeElement;
        var formView = isFormKeyboardTarget(focused)
            ? focused.closest('#view-form, #service-view, #kappe-view')
            : document.querySelector('#view-form.view.active, #service-view.view.active, #kappe-view.view.active');
        if (!formView) return null;
        return formView.querySelector('.mobile-form') || formView;
    }

    function ensureContentObserver(content, isActive, keyboardOpen) {
        // Koble ResizeObserver til når popup er aktiv OG tastatur åpent.
        // Når content endrer størrelse (f.eks. tekst-ekspansjon, dynamisk
        // innhold), trigges ny apply så translate forblir riktig.
        // Bruker scheduleForcedApply slik at content-vekst bypasser
        // state-memoisering (stateKey ville ellers vise "uendret").
        var hasObs = contentResizeObservers.has(content);
        if (isActive && keyboardOpen) {
            if (!hasObs && typeof ResizeObserver === 'function') {
                var ro = new ResizeObserver(scheduleForcedApply);
                ro.observe(content);
                contentResizeObservers.set(content, ro);
            }
        } else if (hasObs) {
            contentResizeObservers.get(content).disconnect();
            contentResizeObservers.delete(content);
        }
    }

    function applyKeyboardLayout() {
        var vv = window.visualViewport || { offsetTop: 0, height: window.innerHeight };
        // Bruker stable (hysteresis-applied) keyboardOpen — ikke rå momentan
        // verdi. Dette unngår toolbar-bouncing når input kortvarig mister
        // fokus under scroll og browser midlertidig viser tastatur som lukket.
        var keyboardOpen = updateKeyboardState();
        // EFFEKTIV tastatur-tilstand for ALL layout (modal/overlay/popup/
        // toolbar). Viewport-deteksjon feiler i installert PWA (tastaturet
        // overlapper uten å krympe viewport). Fokus på et tastatur-felt er
        // derimot 100% pålitelig. IS_TOUCH-gating: på desktop åpnes ikke
        // noe skjermtastatur ved fokus → kbdActive forblir false der.
        var kbdActive = keyboardOpen
            || (IS_TOUCH_DEVICE && typeof isKeyboardOpeningElement === 'function'
                && isKeyboardOpeningElement(document.activeElement));
        var fullHeight = vv.offsetTop + vv.height;
        var activeView = document.querySelector('.view.active');
        var activeId = activeView ? activeView.id : null;
        trackViewportSize();
        // Defensiv cleanup: hvis formKeyboardMode er satt, men keyboardOpen
        // er false (ingen viewport-krymp), så ble den satt feilaktig — typisk
        // av gammel focus-fallback før visualViewport-guard tok over. Rydd opp
        // før vi går videre.
        if (formKeyboardMode && !keyboardOpen) {
            setFormKeyboardMode(false);
        }
        if (!formKeyboardMode && keyboardOpen && isFormKeyboardTarget(document.activeElement)) {
            setFormKeyboardMode(true, document.activeElement);
        }
        if (formKeyboardMode) {
            keyboardOpen = true;
            placeToolbarForFormKeyboard(true, document.activeElement);
        }
        syncKeyboardFocusClass(document.activeElement, keyboardOpen);
        var keyboardFocusActive = document.body.classList.contains('keyboard-focus');

        // === Materiell state-sjekk ===
        // Bygg en signatur av logisk state. Bevisst INGEN vv.height/offsetTop —
        // URL-bar-bevegelse under scroll endrer disse men IKKE den logiske
        // staten, så apply skip'es og momentum-scroll forstyrres ikke. Final
        // vv-verdier (etter tastatur-animasjon, URL-bar-settle) hentes via
        // settle-timer (debounced forced-apply 250ms etter siste resize).
        var activePopupSig = '';
        document.querySelectorAll(POPUP_BACKDROP_SELECTOR).forEach(function(b) {
            if (b.classList.contains('active')) activePopupSig += b.id + ',';
        });
        // Fokus i et redigerbart felt inni en aktiv popup må være en del av
        // state-signaturen — ellers deduper state-memo'en bort apply'en når
        // tastatur-deteksjonen bommer (keyboardOpen uendret), og den fokus-
        // baserte popup-cap-en ville aldri kjørt.
        var popupFocusSig = '';
        if (IS_TOUCH_DEVICE) {
            var _ae = document.activeElement;
            if (_ae && typeof isKeyboardOpeningElement === 'function' && isKeyboardOpeningElement(_ae)
                && _ae.closest) {
                var _bd = _ae.closest(POPUP_BACKDROP_SELECTOR);
                if (_bd && _bd.classList.contains('active')) popupFocusSig = _bd.id || '1';
            }
        }
        var activeOverlaySig = '';
        FULLSCREEN_OVERLAY_IDS.forEach(function(id) {
            var o = document.getElementById(id);
            if (o && o.classList.contains('active')) activeOverlaySig += id + ',';
        });
        var activeModalBodySig = '';
        if (MODAL_VIEW_IDS.indexOf(activeId) !== -1) {
            var activeModalView = document.getElementById(activeId);
            if (activeModalView) {
                var activeBodies = activeModalView.querySelectorAll('.modal-body');
                for (var bodyIdx = 0; bodyIdx < activeBodies.length; bodyIdx++) {
                    if (activeBodies[bodyIdx].offsetParent !== null) {
                        activeModalBodySig = activeBodies[bodyIdx].id || String(bodyIdx);
                        break;
                    }
                }
            }
        }
        // servicebil-inntak-mode endrer toolbar-host (til picker-overlay-list)
        // selv om aktive popups/overlays er identisk. Må derfor være i state-key.
        var inntakMode = document.body.classList.contains('servicebil-inntak-mode') ? '1' : '0';
        var stateKey =
            (keyboardOpen ? '1' : '0') + '|' +
            (kbdActive ? '1' : '0') + '|' +
            (keyboardFocusActive ? '1' : '0') + '|' +
            (activeId || '') + '|' +
            activeModalBodySig + '|' +
            activePopupSig + '|' +
            popupFocusSig + '|' +
            activeOverlaySig + '|' +
            inntakMode;
        if (stateKey === lastAppliedState && !forceNextApply) return;
        lastAppliedState = stateKey;
        forceNextApply = false;

        // === Viewport meta: kritisk fiks for popup-scroll-lås i PWA ===
        // `interactive-widget=resizes-visual` lar Chrome PWA panorere VISUAL
        // viewport med touch-drag når tastaturet er åpent (skjemaet bak blir
        // synlig fordi visual viewport viser et annet utsnitt av layout
        // viewport). Den panoreringen er en browser-native feature som omgår
        // CSS touch-action OG JS preventDefault på touchmove. Eneste måten
        // å hindre det på er å fjerne separasjonen mellom visual og layout
        // viewport — bytte til `overlays-content` (tastatur overlay'er,
        // ingen viewport-separasjon, ingen panorering mulig). Skjemaet
        // beholder `resizes-visual` (best for scroll til fokusert felt) når
        // popup IKKE er åpen.
        if (typeof _syncViewportMetaForPopup === 'function') {
            _syncViewportMetaForPopup(!!activePopupSig);
        }

        // --- Toggle body.keyboard-open for physical keyboard state ---
        // Form-layout styres av body.keyboard-focus, ikke keyboard-open.
        // keyboard-open brukes fortsatt til modal/overlay-height.
        document.body.classList.toggle('keyboard-open', kbdActive);

        // Reset keyboard-spacer padding på alle scrollere som ble paddet
        // mens tastaturet var åpent. Etter reset oppfører sidene seg som
        // før tastaturet åpnet — ingen permanent padding eller scroll-rest.
        if (!kbdActive) {
            _resetAllKbdSpacers();
        }

        // Topp-forankrede popuper (spec/FSC/FSW/kabelhylse, iso-kort): suspender
        // marginTop mens tastatur er åpent (den regnes fra full skjermhøyde og
        // ville dyttet inputs/knapper bak tastaturet); re-forankres ved lukking.
        // Må skje FØR popup-cap-en under, så cap/translate ser ren posisjon.
        if (typeof _reconcileTopAnchorsForKeyboard === 'function') {
            _reconcileTopAnchorsForKeyboard(kbdActive);
        }

        // --- Modal-views: krymp til synlig viewport ---
        MODAL_VIEW_IDS.forEach(function(id) {
            var view = document.getElementById(id);
            if (!view) return;
            var isModalActive = view.classList.contains('active');
            if (kbdActive && isModalActive) {
                view.style.top = vv.offsetTop + 'px';
                view.style.bottom = 'auto';
                view.style.height = vv.height + 'px';
                view.style.minHeight = '0';
            } else {
                view.style.top = '';
                view.style.bottom = '';
                view.style.height = '';
                view.style.minHeight = '';
            }
        });

        // --- Form-views: CSS eier tastatur-layouten. Rydd vekk eventuell
        // inline height fra eldre kjøringer slik toolbar ikke blir låst over
        // tastaturet i en intern scroll-container.
        FORM_VIEW_IDS.forEach(function(id) {
            var view = document.getElementById(id);
            if (!view) return;
            view.style.height = '';
            view.style.minHeight = '';
        });

        // --- Toolbar reparenting: inn i scrollable host når tastatur er åpent ---
        // Toolbar appendes til den scrollable container'en slik at den scroller
        // SAMMEN med innholdet. Hvilken container som er host avhenger av kontekst:
        //   - Form-views: aktiv .mobile-form, nederst i selve skjemaet
        //   - Modal-views (saved/template/settings): aktiv .modal-body
        //   - Servicebil-inntak-mode: picker-overlay-list (picker IS skjemaet,
        //     så toolbar må være innenfor picker-overlay-list-scrollen)
        // En MutationObserver-vakt re-appender toolbar hvis innerHTML på lista
        // ødelegger den under re-rendering.
        var toolbar = document.querySelector('.toolbar');
        if (toolbar) {
            // REDESIGN: skjema-views reparenterer ALDRI toolbaren (formHost
            // alltid null). Den blir i <body> og styres rent av CSS
            // (body.kbd-editing/keyboard-focus → static, siste i scroll).
            // Modal-views beholder sin --inflow-reparenting (modalHost).
            var formHost = null;
            var modalHost = findToolbarScrollHost(kbdActive, activeId);
            if (formHost) {
                stopToolbarGuard();
                prepareKeyboardToolbarHost(formHost);
                toolbar.classList.remove('toolbar--inflow');
                toolbar.classList.add('toolbar--keyboard-form');
                if (toolbar.parentNode !== formHost) {
                    formHost.appendChild(toolbar);
                }
            } else if (modalHost) {
                prepareKeyboardToolbarHost(modalHost);
                toolbar.classList.add('toolbar--inflow');
                toolbar.classList.remove('toolbar--keyboard-form');
                if (toolbar.parentNode !== modalHost) {
                    modalHost.appendChild(toolbar);
                    startToolbarGuard(modalHost, toolbar);
                }
            } else {
                // Ingen modal-host: toolbar skal være i body uten --inflow-klasse.
                // Garanterer alltid at klassen fjernes (selv om toolbar allerede
                // er i body) — kritisk fordi --inflow-CSS bruker position: static
                // og negativ margin som er feil for body-context.
                stopToolbarGuard();
                clearKeyboardToolbarHosts();
                if (toolbar.classList.contains('toolbar--inflow')) {
                    toolbar.classList.remove('toolbar--inflow');
                }
                if (!document.body.classList.contains('keyboard-focus')) {
                    toolbar.classList.remove('toolbar--keyboard-form');
                }
                if (toolbar.parentNode !== document.body) {
                    document.body.appendChild(toolbar);
                }
            }
        }

        // --- Fullscreen-overlays (picker etc.): krymp til synlig viewport ---
        // Disse er position:fixed med height:100%/100dvh og strekker seg
        // bak tastaturet. Hvis ikke krympet, mister browseren touch-events
        // for området bak tastaturet, og scroll i intern liste fungerer ikke.
        FULLSCREEN_OVERLAY_IDS.forEach(function(id) {
            var overlay = document.getElementById(id);
            if (!overlay) return;
            // Backdropen SKAL alltid være full skjerm (CSS inset:0) når aktiv.
            // Den tidligere krympingen til vv.height gjorde at backdropen ble
            // en kort stripe øverst → skjemaet bak ble synlig/lyst og «blødde
            // gjennom». Popupens innhold cappes separat i popup-cap-grenen
            // (max-height + translateY); backdropen trenger aldri krympes.
            // Vi nullstiller defensivt for å rydde evt. stale inline-styles.
            overlay.style.top = '';
            overlay.style.bottom = '';
            overlay.style.height = '';
        });

        // --- Popups: max-height piksel-cap + translateY-ankring over tastatur ---
        // Targeter alle popup-content under aktive backdrops. Cap'er max-height
        // så content ikke kan bli større enn synlig område. Deretter måles
        // faktisk posisjon i DOM og flyttes bare hvis bunnen ligger under
        // synlig viewport. Dette må baseres på getBoundingClientRect(), ikke
        // window.innerHeight/2, fordi noen popups ligger i backdrops som selv
        // krympes når tastaturet er åpent.
        // Tilgjengelig høyde = den MINSTE av visualViewport.height og
        // window.innerHeight. Robust på tvers av nettlesere: Chrome/Safari
        // krymper visualViewport når tastaturet åpnes, Firefox Android
        // krymper ofte window.innerHeight i stedet. Å bruke kun vv.height
        // (som før) gjorde at cap-en ikke virket på Firefox Android.
        var _vvH = window.visualViewport ? window.visualViewport.height : (window.innerHeight || 0);
        var _vvTop = window.visualViewport ? window.visualViewport.offsetTop : 0;
        var visH = Math.min(_vvH, window.innerHeight || _vvH);
        var visBottom = _vvTop + visH;

        var allContents = document.querySelectorAll(POPUP_CONTENT_SELECTOR);
        allContents.forEach(function(s) {
            var backdrop = s.closest(POPUP_BACKDROP_SELECTOR);
            var isActive = !!(backdrop && backdrop.classList.contains('active'));
            ensureContentObserver(s, isActive, kbdActive);
            // Posisjoner når tastaturet er aktivt (kbdActive = viewport-krymp
            // ELLER touch+fokus-felt → deterministisk, virker i PWA).
            if (!isActive) {
                // Popup lukket → full rens. Neste åpning starter friskt.
                if (backdrop) backdrop.classList.remove('popup-top-anchored');
                s.style.removeProperty('max-height');
                s.style.transform = '';
                s.style.transition = '';
                s.style.marginTop = '';
                return;
            }
            if (!kbdActive) {
                // Popup ÅPEN men tastatur LUKKET: behold eksisterende lift/cap
                // (satt forrige gang tastaturet var åpent) så popupen IKKE
                // hopper tilbake til midten når brukeren scroller for å lukke
                // tastaturet — listas scroll og popupens flytting samtidig er
                // forvirrende UX. Reset skjer kun ved popup-close (over).
                // Neste tastatur-åpning re-beregner uten å nullstille mellom.
                return;
            }
            // Krev EKTE tastatur-signal før vi kapper popupen. På PC (også i
            // dev-mode touch-emulering) er kbdActive true ved fokus på input
            // selv om det ikke finnes noe skjermtastatur — uten denne gaten
            // ville popup-cap krympet sheeten unødvendig. Ingen signal →
            // ingen cap, popup beholder naturlig størrelse (CSS max-height:
            // 80vh håndterer overdimensjonering). Samme kontrakt som i
            // ensureKeyboardTargetVisible.
            var kbdTop = _getKeyboardTop();
            if (kbdTop === null) {
                if (backdrop) backdrop.classList.remove('popup-top-anchored');
                s.style.removeProperty('max-height');
                s.style.transform = '';
                s.style.transition = '';
                s.style.marginTop = '';
                return;
            }

            if (backdrop) backdrop.classList.remove('popup-top-anchored');
            s.style.marginTop = '';
            s.style.transition = 'none';
            s.style.transform = '';

            var safeH = Math.max(180, kbdTop - KEYBOARD_MARGIN * 2);
            var desiredBottom = kbdTop - KEYBOARD_MARGIN;
            s.style.setProperty('max-height', safeH + 'px', 'important');
            var rect2 = s.getBoundingClientRect();
            var lift = Math.max(0, Math.round(rect2.bottom - desiredBottom));
            // Tak: ikke løft popupens topp under KEYBOARD_MARGIN fra skjerm-topp.
            var maxLift = Math.max(0, Math.round(rect2.top - (_vvTop + KEYBOARD_MARGIN)));
            lift = Math.min(lift, maxLift);
            s.style.transform = lift ? 'translateY(-' + lift + 'px)' : '';

            // Vekk Chromes compositor sin scroll-state: etter at sheet-
            // størrelsen endres (max-height + transform) vet ikke gesture-
            // detector ennå at den interne scrolleren plutselig kan scrolle
            // → første touchmove tolkes som «ikke-scrollbar» og scroll skjer
            // ikke; andre touch virker fordi compositor har oppdatert seg.
            // Tvinger synkron reflow (offsetHeight-lesning) + no-op scrollTop-
            // skriv på interne scrollere som faktisk har overflow → Chrome
            // re-evaluerer scrollability før neste touch.
            var _scrollers = s.querySelectorAll('.spec-popup-body, .confirm-modal-content, .fakturaadresse-popup-body, .modal-body, .picker-overlay-list');
            for (var _si = 0; _si < _scrollers.length; _si++) {
                var _scEl = _scrollers[_si];
                void _scEl.offsetHeight;
                if (_scEl.scrollHeight > _scEl.clientHeight) {
                    var _scSt = _scEl.scrollTop;
                    _scEl.scrollTop = _scSt + 1;
                    _scEl.scrollTop = _scSt;
                }
            }
        });

        // Confirm-modal padding-bottom håndteres nå via CSS-regelen
        // body.keyboard-open .confirm-modal { padding-bottom: 0 }
    }

    // Eksponer globalt — bruk i edge cases der man trenger å trigge eksplisitt.
    // I 99% av tilfellene er dette ikke nødvendig (alle triggers er automatiske).
    window.applyKeyboardLayout = scheduleApply;

    // === Trigger-registrering ===

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function() {
            settleClosedKeyboardFromMetrics();
            // Umiddelbar apply: state-memo filtrerer URL-bar-mikrobevegelser.
            // Hvis logisk state har endret seg (keyboardOpen, popups), kjører
            // apply for å gi rask respons.
            scheduleApply();
            // Debounced forced-apply: 250ms etter siste resize forces re-apply
            // for å fange final vv.height etter:
            //   - Tastatur-animasjon (multiple resize-events under animasjon)
            //   - URL-bar-settle etter scroll
            //   - Orienterings-rotasjon
            // forceNextApply bypasser state-memo så piksel-cap, view-høyde og
            // overlay-størrelse oppdateres med faktiske nye vv-verdier.
            scheduleSettleApply();
            scheduleKeyboardTargetVisibilityCheck(document.activeElement);
        });
        // visualViewport.scroll dropet bevisst — fyrer per frame under scroll
        // når URL-bar beveger seg, ville avbryte momentum hvis lyttet på.
    }
    var settleTimer = null;
    function scheduleSettleApply() {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function() {
            settleTimer = null;
            scheduleForcedApply();
        }, 250);
    }

    // Subtree MutationObserver på document.body — fanger BÅDE class-endringer
    // (popup åpnes/lukkes via .active-klassen) OG dynamisk innsatte popups
    // (legges til DOM etter sidelasting). Filtrert til kun relevante mutations
    // for ytelse — selve apply'en er rAF-debounced så maks 1/frame.
    var domObserver = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type === 'attributes' && m.attributeName === 'class') {
                var t = m.target;
                // Trigger apply for class-endringer på:
                //  - body (f.eks. servicebil-inntak-mode → endrer toolbar-host)
                //  - popup-backdrops (popup åpnes/lukkes)
                //  - .view (view-bytte, .active flyttes mellom views)
                if (t === document.body) {
                    scheduleApply();
                    return;
                }
                if (t && t.nodeType === 1 && typeof t.matches === 'function' &&
                    (t.matches(POPUP_BACKDROP_SELECTOR) || t.matches('.view'))) {
                    scheduleApply();
                    return;
                }
            } else if (m.type === 'childList' && m.addedNodes && m.addedNodes.length > 0) {
                for (var j = 0; j < m.addedNodes.length; j++) {
                    var n = m.addedNodes[j];
                    if (n.nodeType !== 1) continue;
                    if ((n.matches && n.matches(POPUP_BACKDROP_SELECTOR)) ||
                        (n.querySelector && n.querySelector(POPUP_BACKDROP_SELECTOR))) {
                        scheduleApply();
                        return;
                    }
                }
            }
        }
    });
    domObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
    });

    // focusin/focusout: fallback-trigger. Noen browsere fyrer focus FØR
    // visualViewport.resize, så uten denne ville første frame etter fokus
    // ha feil layout.
    //
    // KRITISK: Filtrer til kun elementer som FAKTISK åpner tastatur
    // (text-inputs, textarea, contenteditable). Uten dette ville fokus på
    // ENHVER focusable (knapp, checkbox) trigge applyKeyboardLayout som
    // tvinger layout-reflow via offsetHeight-lesing — det avbryter
    // scroll-momentum når brukeren scroller i en popup-liste og fingeren
    // strøyfer en focusable item på vei (klassisk "første swipe stopper"-bug).
    function isKeyboardOpeningElement(el) {
        if (!el || el.nodeType !== 1) return false;
        var tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (el.isContentEditable) return true;
        if (tag === 'INPUT') {
            var type = (el.type || 'text').toLowerCase();
            // Disse input-typene åpner skjermtastatur. Ekskluderer button,
            // checkbox, radio, file, color, range, submit, image, reset.
            return ['text', 'tel', 'email', 'number', 'search', 'url', 'password', 'date', 'time', 'datetime-local', 'month', 'week'].indexOf(type) !== -1;
        }
        return false;
    }

    function findKeyboardScrollContainer(el) {
        if (typeof _findScrollableAncestor === 'function') {
            return _findScrollableAncestor(el);
        }
        return document.scrollingElement || document.documentElement;
    }

    // === Keyboard spacer ===
    // Når et input er HELT NEDERST på en scroll-container, er det ikke noe
    // mer innhold under det å scrolle til → maxScroll er allerede nådd →
    // window.scrollBy() kan ikke løfte feltet over tastaturet. Standard
    // løsning (iOS UIKit keyboardLayoutGuide / Android adjustResize):
    // utvid scroll-rangen midlertidig ved å gi scrolleren padding-bottom
    // lik tastatur-høyden. Da fins det "tom plass" nederst å scrolle inn
    // i, og auto-scrollen kan løfte input over tastaturet.
    var _kbdSpacedScrollers = new Set();
    var _kbdSpacerOriginal = new WeakMap();
    function _applyKbdSpacer(scroller, paddingPx) {
        if (!scroller || !(paddingPx > 0)) return;
        if (!_kbdSpacedScrollers.has(scroller)) {
            // Lagre original inline-padding så vi kan restaurere den nøyaktig.
            _kbdSpacerOriginal.set(scroller, scroller.style.paddingBottom || '');
            _kbdSpacedScrollers.add(scroller);
        }
        // !important slår CSS-regler som body.kbd-editing { padding-bottom: 0 }.
        scroller.style.setProperty('padding-bottom', paddingPx + 'px', 'important');
    }
    function _resetAllKbdSpacers() {
        _kbdSpacedScrollers.forEach(function(scroller) {
            var orig = _kbdSpacerOriginal.get(scroller);
            if (orig) {
                scroller.style.paddingBottom = orig;
            } else {
                scroller.style.removeProperty('padding-bottom');
            }
            _kbdSpacerOriginal.delete(scroller);
        });
        _kbdSpacedScrollers.clear();
    }

    // Returnerer y-koordinaten (viewport-koord) av BUNNEN av cursor-linjen
    // i et multilinje-felt — eller null hvis ikke aktuelt/mulig. Brukes så
    // autoscroll håndterer caret-posisjon, ikke hele textarea-rect (et tall
    // textarea kan ha topp synlig mens cursoren er bak tastaturet).
    function _effectiveCaretBottom(el) {
        if (!el) return null;
        if (el.tagName === 'TEXTAREA') {
            try {
                var value = el.value || '';
                var pos = (typeof el.selectionStart === 'number') ? el.selectionStart : value.length;
                var linesBefore = value.substring(0, pos).split('\n').length;
                var cs = getComputedStyle(el);
                var lineHeight = parseFloat(cs.lineHeight);
                if (!lineHeight || isNaN(lineHeight)) {
                    lineHeight = (parseFloat(cs.fontSize) || 14) * 1.4;
                }
                var paddingTop = parseFloat(cs.paddingTop) || 0;
                var rect = el.getBoundingClientRect();
                // Bunnen av cursorens linje, justert for evt. intern scroll.
                return rect.top + paddingTop + linesBefore * lineHeight - (el.scrollTop || 0);
            } catch (e) { return null; }
        }
        if (el.isContentEditable) {
            try {
                var sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    var range = sel.getRangeAt(0);
                    var rects = range.getClientRects();
                    if (rects && rects.length) return rects[rects.length - 1].bottom;
                    var r = range.getBoundingClientRect();
                    if (r && r.bottom) return r.bottom;
                }
            } catch (e) { return null; }
        }
        return null;
    }

    function ensureKeyboardTargetVisible(el) {
        if (!isKeyboardOpeningElement(el) || !document.body.contains(el)) return;
        // Site-wide standard-oppførsel: når brukeren fokuserer et tekstfelt
        // OG et reelt skjermtastatur er åpent → scroll feltet over tastaturet
        // hvis det vil havne bak. Hvis allerede synlig → ingen scroll.
        // KREVER ekte tastatur-signal (VirtualKeyboard API ELLER vv-krymp).
        // På PC (desktop, ingen skjermtastatur) gir begge null → vi gjør
        // INGENTING (browseren har sin egen native focus-scroll uansett).
        // Dette gjelder mobil, nettbrett, PC, hybrid-enheter: kun reagér på
        // bekreftet tastatur-tilstedeværelse, aldri gjett.
        var kbdTop = _getKeyboardTop();
        if (kbdTop === null) return;

        var rect = el.getBoundingClientRect();
        var vv = window.visualViewport;
        var viewportTop = vv ? vv.offsetTop : 0;
        var viewportBottom = kbdTop;
        var topPadding = 56;
        var bottomPadding = 16;

        var toolbar = document.querySelector('.toolbar');
        if (toolbar) {
            var toolbarStyle = getComputedStyle(toolbar);
            if (toolbarStyle.position === 'fixed' && toolbarStyle.display !== 'none') {
                bottomPadding += toolbar.offsetHeight || 0;
            }
        }

        var minTop = viewportTop + topPadding;
        var maxBottom = viewportBottom - bottomPadding;
        var delta = 0;

        // For multilinje-felt (textarea/contenteditable) bruk CURSOR-POSISJON
        // som "bunn", ikke hele elementets rect. En lang textarea kan ha
        // topp synlig mens cursoren (på en lav linje) er bak tastaturet —
        // uten denne ville auto-scrollet feilaktig konkludert at "topp er
        // synlig → ingen scroll trengs". Faller tilbake til rect.bottom for
        // korte inputs eller når caret-måling ikke er tilgjengelig.
        var caretBottom = _effectiveCaretBottom(el);
        var effBottom = (caretBottom !== null && caretBottom > 0) ? caretBottom : rect.bottom;

        if (effBottom > maxBottom) {
            delta = effBottom - maxBottom;
        } else if (rect.top < minTop) {
            // Topp av elementet over visible-topp → scroll ned (bring topp i syne).
            // Bruker rect.top her (ikke caret) fordi en tall textarea med caret
            // i nederste del skal IKKE scrolles ned bare fordi rect.top er over
            // skjermen — caret er allerede synlig.
            if (effBottom < minTop) delta = rect.top - minTop;
        }

        var scroller = findKeyboardScrollContainer(el);

        // Keyboard spacer: hvis input er nær slutten av scroll-rangen er det
        // ikke nok room til å scrolle videre. Utvid scroll-rangen med
        // padding-bottom lik tastaturhøyden + buffer, så autoscrollet kan
        // løfte input over tastaturet selv på siste rad. Site-wide for ALLE
        // scrollere (form, modal, popup-body, picker-list). Reset gjøres
        // sentralt i applyKeyboardLayout når kbdActive=false.
        if (scroller && kbdTop !== null) {
            var _innerH = window.innerHeight || 0;
            var _kbdH = _innerH > 0 ? _innerH - kbdTop : 0;
            if (_kbdH > 0) {
                _applyKbdSpacer(scroller, _kbdH + bottomPadding);
            }
        }

        if (Math.abs(delta) < 1) return;

        if (!scroller) return;
        if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
            window.scrollBy(0, delta);
        } else {
            scroller.scrollTop += delta;
        }
    }

    function scheduleKeyboardTargetVisibilityCheck(el) {
        if (!isKeyboardOpeningElement(el)) return;
        requestAnimationFrame(function() {
            ensureKeyboardTargetVisible(el);
            requestAnimationFrame(function() {
                ensureKeyboardTargetVisible(el);
            });
        });
        setTimeout(function() { ensureKeyboardTargetVisible(el); }, 280);
    }

    // Når brukeren tapper en annen linje i et multilinje-felt uten å bytte
    // fokus (cursor flyttes innenfor textarea/contenteditable), fyrer
    // `selectionchange` på document. Vi re-sjekker synlighet så cursoren
    // alltid er synlig over tastaturet — ikke bare ved første fokus.
    // rAF-debouncing forhindrer over-aggressiv scroll under typing.
    var _selChangeRaf = 0;
    document.addEventListener('selectionchange', function() {
        if (_selChangeRaf) return;
        _selChangeRaf = requestAnimationFrame(function() {
            _selChangeRaf = 0;
            var ae = document.activeElement;
            if (!ae) return;
            if (ae.tagName !== 'TEXTAREA' && !ae.isContentEditable) return;
            ensureKeyboardTargetVisible(ae);
        });
    });

    // Multilinje-felt (textarea, contenteditable) vokser/krymper når
    // brukeren skriver eller sletter linjer. ResizeObserver gir oss et
    // pålitelig signal hver gang feltet endrer høyde → kjør visibility-
    // sjekk på nytt så autoscrollet løfter nye linjer over tastaturet
    // (og reverse-scroller når linjer slettes). Site-wide for ALLE
    // multilinje-felt: Beskrivelse, Merknad, kappe-kommentarer,
    // popup-tekstfelt — uansett hvor i appen.
    var _multilineRO = null;
    var _multilineEl = null;
    function _isMultilineField(el) {
        if (!el || el.nodeType !== 1) return false;
        return el.tagName === 'TEXTAREA' || el.isContentEditable === true;
    }
    // Husk siste keyboard-felt som hadde fokus så vi kan bringe det tilbake
    // i syne etter handoff (når scroll-clamp kunne ha "hoppet" oss langt
    // bort, typisk etter at multiline-textarea har vokst og dokumentet ble
    // scrollet ned for å holde bunnen over tastatur).
    var _lastKbdFocusedEl = null;
    function _attachMultilineWatcher(el) {
        _detachMultilineWatcher();
        if (!_isMultilineField(el)) return;
        if (typeof ResizeObserver !== 'function') return;
        _multilineEl = el;
        _multilineRO = new ResizeObserver(function() {
            // Ingen autoscroll uten ekte tastatur-signal — gaten i
            // ensureKeyboardTargetVisible håndterer PC-tilfellet.
            if (_multilineEl && document.body.contains(_multilineEl)) {
                ensureKeyboardTargetVisible(_multilineEl);
            }
        });
        try { _multilineRO.observe(el); } catch (e) { _detachMultilineWatcher(); }
    }
    function _detachMultilineWatcher() {
        if (_multilineRO) {
            try { _multilineRO.disconnect(); } catch (e) {}
            _multilineRO = null;
        }
        _multilineEl = null;
    }

    // === Fokus-drevet skjema-tastatur (DETERMINISTISK) ===
    // Tastatur-deteksjon via viewport feiler i installert PWA (tastaturet
    // overlapper uten å krympe viewport). Fokus er derimot 100% pålitelig.
    // body.kbd-editing settes når et skjema-tekstfelt på en touch-enhet får
    // fokus → CSS gjør skjemaet til ett normalt scroll-dokument og toolbaren
    // til siste statiske element (scroll helt ned for å se den). Lukkes
    // tastaturet (fokus forlater feltet) → klassen fjernes → toolbar fixed.
    var _kbdEditClearTimer = null;
    function _isFormKbdField(el) {
        return !!(IS_TOUCH_DEVICE && el && typeof isFormKeyboardTarget === 'function'
            && isFormKeyboardTarget(el));
    }
    // Scroll-posisjon-overføring over container↔dokument-byttet. Form-viewen er
    // ÉN node som er sin egen interne scroller (position:fixed + overflow:auto)
    // normalt, men blir position:static/overflow:visible (dokumentet scroller)
    // under body.kbd-editing. De to scroll-posisjonene er uavhengige og
    // overføres ingen andre steder → uten dette hopper innholdet ved bytte.
    // Helperen eier selve classList-mutasjonen så lesning/mutasjon/skriving
    // skjer i SAMME tick (ingen rAF — en frame ville male upairet posisjon).
    function _handoffKbdScroll(direction, opts) {
        opts = opts || {};
        var fromScrollDismiss = !!opts.fromScrollDismiss;
        var el = document.querySelector('#view-form.view.active, #service-view.view.active, #kappe-view.view.active');
        if (!el) {
            if (direction === 'toBody') document.body.classList.add('kbd-editing');
            else document.body.classList.remove('kbd-editing');
            return;
        }
        var doc = document.scrollingElement || document.documentElement;
        function clamp(v, max) { return Math.max(0, Math.min(v, max || 0)); }
        if (direction === 'toBody') {
            var src = el.scrollTop;                                  // pre-swap intern scroll
            document.body.classList.add('kbd-editing');              // → static, body scroller
            var offset = el.getBoundingClientRect().top + window.scrollY; // synkron reflow
            window.scrollTo(0, clamp(src + offset, doc.scrollHeight - doc.clientHeight));
        } else {
            var srcY = doc.scrollTop;
            var off = el.getBoundingClientRect().top + window.scrollY;
            document.body.classList.remove('kbd-editing');          // → fixed, intern scroller
            el.scrollTop = clamp(srcY - off, el.scrollHeight - el.clientHeight);
            window.scrollTo(0, 0);                                   // defensiv normalisering

            // Yank-back til siste fokuserte felt — KUN ved tap-utenfor-dismiss
            // (recovery fra clamp etter spacer-fjerning). Ved scroll-dismiss
            // har brukeren bevisst flyttet seg vekk; honorér den intensjonen
            // (matcher iOS keyboardDismissMode=.onDrag-oppførsel).
            if (!fromScrollDismiss
                && _lastKbdFocusedEl && el.contains(_lastKbdFocusedEl)) {
                var r = _lastKbdFocusedEl.getBoundingClientRect();
                var elRect = el.getBoundingClientRect();
                if (r.bottom < elRect.top || r.top > elRect.bottom) {
                    try { _lastKbdFocusedEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
                }
            }
        }
    }
    // Scroll-utløst lukking: scroller-byttet (position:static→fixed) dreper en
    // pågående momentum-fling. Derfor utsettes handoff til scrollingen har
    // stilnet (debounce på scroll-stillhet) i stedet for en fast timer som
    // lander midt i flingen. blur()/tastatur-skjul skjer uansett umiddelbart;
    // kun det visuelle scroller-byttet ventes.
    var _kbdScrollSettleTimer = null;
    var _kbdScrollHandoffMaxTimer = null;
    var _kbdScrollHandoffPending = false;
    var _KBD_SCROLL_SETTLE_MS = 140;
    function _cancelPendingScrollHandoff() {
        _kbdScrollHandoffPending = false;
        if (_kbdScrollSettleTimer) { clearTimeout(_kbdScrollSettleTimer); _kbdScrollSettleTimer = null; }
        if (_kbdScrollHandoffMaxTimer) { clearTimeout(_kbdScrollHandoffMaxTimer); _kbdScrollHandoffMaxTimer = null; }
    }
    function _commitScrollHandoff() {
        if (!_kbdScrollHandoffPending) return;
        _cancelPendingScrollHandoff();
        // Re-fokusert et felt mens vi ventet → bruker skriver igjen, ingen swap.
        if (!_isFormKbdField(document.activeElement)) {
            // fromScrollDismiss=true: ikke yank-tilbake til fokusert felt.
            // Brukeren har bevisst scrollet vekk; honorér posisjonen.
            _handoffKbdScroll('toContainer', { fromScrollDismiss: true });
        }
    }
    function _scheduleScrollSettledHandoff() {
        _kbdScrollHandoffPending = true;
        if (_kbdScrollSettleTimer) clearTimeout(_kbdScrollSettleTimer);
        _kbdScrollSettleTimer = setTimeout(_commitScrollHandoff, _KBD_SCROLL_SETTLE_MS);
        // Sikkerhetstak: aldri heng i påvente av scroll-stillhet for alltid.
        if (!_kbdScrollHandoffMaxTimer) {
            _kbdScrollHandoffMaxTimer = setTimeout(_commitScrollHandoff, 2500);
        }
    }
    document.addEventListener('scroll', function() {
        if (!_kbdScrollHandoffPending) return;
        // Fortsatt scroll/momentum → skyv settle-timeren ut.
        if (_kbdScrollSettleTimer) clearTimeout(_kbdScrollSettleTimer);
        _kbdScrollSettleTimer = setTimeout(_commitScrollHandoff, _KBD_SCROLL_SETTLE_MS);
    }, { passive: true, capture: true });

    function _setKbdEditing(on) {
        if (on) {
            if (_kbdEditClearTimer) { clearTimeout(_kbdEditClearTimer); _kbdEditClearTimer = null; }
            // Bruker fokuserer felt igjen → avbryt evt. ventende scroll-handoff
            // (skal IKKE bytte scroller; brukeren skriver videre).
            _cancelPendingScrollHandoff();
            // Allerede i kbd-editing (rask felt→felt-bytte) = ingen swap →
            // ingen handoff, ellers ville vi nullstilt scroll uten grunn.
            if (document.body.classList.contains('kbd-editing')) return;
            _handoffKbdScroll('toBody');
        } else {
            if (_kbdEditClearTimer) clearTimeout(_kbdEditClearTimer);
            if (_kbdScrollBlurred) {
                // Scroll utløste lukkingen: hold kbd-editing (dokumentet
                // forblir scroller) til flingen har stilnet, så gjør handoff.
                _scheduleScrollSettledHandoff();
            } else {
                // Tapp/annet ekte blur: ingen momentum å bevare → rask
                // grace. focusout har allerede sjekket relatedTarget — vi
                // vet det IKKE er felt→felt-bytte. Kort grace dekker
                // kanttilfeller hvor relatedTarget mangler men en
                // programmatisk fokus-flytt følger umiddelbart.
                _kbdEditClearTimer = setTimeout(function() {
                    _kbdEditClearTimer = null;
                    if (!_isFormKbdField(document.activeElement)) {
                        _handoffKbdScroll('toContainer');
                    }
                }, 30);
            }
        }
    }

    document.addEventListener('focusin', function(e) {
        if (_isFormKbdField(e.target)) {
            _setKbdEditing(true);
        }
        if (isKeyboardOpeningElement(e.target)) {
            // Husk siste keyboard-felt så handoff kan bringe det tilbake i
            // syne etter dismiss (forhindrer clamp-til-bunn-hopp etter at
            // multiline-textarea har vokst).
            _lastKbdFocusedEl = e.target;
            // Undertrykk scroll/tapp-til-lukk i 350ms etter ENHVER tastatur-
            // fokus (ikke kun skjema): rett etter fokus kjører programmatisk
            // scroll-into-view og evt. popup-cap-layout som ellers ville utløst
            // en umiddelbar blur → tastatur åpner/lukker (blink).
            _kbdDismissGuardUntil = Date.now() + 350;
            keyboardBaselineInnerHeight = Math.max(keyboardBaselineInnerHeight || 0, window.innerHeight || 0);
            // Preemptiv keyboard-layout-setting: bare gjør dette hvis vi vet at
            // viewport faktisk krymper på denne enheten (ekte mobil/touch). På
            // desktop og hybrid-enheter (laptops med touchscreen, eller
            // browsere som rapporterer pointer:coarse uten å åpne tastatur) vil
            // viewport ALDRI krympe — derfor må vi vente på faktisk
            // viewport-resize før vi reparenter toolbar. Uten denne guarden
            // ble toolbar feilaktig flyttet inn i form-view ved hver focus.
            var hasConfirmedShrink = viewportKeyboardDetectionConfirmed || layoutKeyboardDetectionConfirmed;
            var canPreempt = hasConfirmedShrink || !window.visualViewport;
            if (canPreempt && isFormKeyboardTarget(e.target)) {
                stableKeyboardOpen = true;
                if (keyboardCloseTimer) { clearTimeout(keyboardCloseTimer); keyboardCloseTimer = null; }
                setFormKeyboardMode(true, e.target);
                syncKeyboardFocusClass(e.target, true);
            }
            scheduleKeyboardTargetVisibilityCheck(e.target);
            scheduleApply();
        }
        // Multilinje-felt: følg høyde-endringer mens fokusert (ny linje
        // lagt til/slettet) så autoscrollet løfter ny linje over tastaturet.
        if (_isMultilineField(e.target)) _attachMultilineWatcher(e.target);
    });
    document.addEventListener('focusout', function(e) {
        if (_isFormKbdField(e.target)) {
            // Felt→felt-bytte: relatedTarget = neste fokuserte element. Hvis
            // det også er et form-felt, hopp over removal helt — kbd-editing
            // forblir og toolbar trenger ikke flytte seg. Sparer både flicker
            // OG den synlige forsinkelsen fra grace-timeren.
            if (e.relatedTarget && _isFormKbdField(e.relatedTarget)) {
                return;
            }
            _setKbdEditing(false);
        }
        if (isKeyboardOpeningElement(e.target)) {
            scheduleForcedApply();
        }
        if (_isMultilineField(e.target)) _detachMultilineWatcher();
    });

    // === Enkel tastatur-lukking i tette skjemaer ===
    // I PWA krymper ikke viewporten når tastaturet åpnes → eneste pålitelige
    // lukke-signal er at det fokuserte feltet får blur (focusout →
    // _setKbdEditing(false) → body.kbd-editing fjernes → .toolbar fixed igjen).
    // Skjemaene er så input-tette at det er vanskelig å treffe «tom plass» for
    // å blurre. To native mønstre gjør et rent blur trivielt; begge gjenbruker
    // den beviste focusout-stien (kaller bare blur()).
    var _kbdDismissGuardUntil = 0;
    var _kbdTouchStartY = 0;
    var _kbdScrollBlurred = false;
    function _kbdDismissArmed() {
        // Site-wide: scroll/tapp lukker tastatur uansett HVOR fokuset er
        // (skjema-felt, popup-input, modal-input, picker-search, osv.).
        // Tidligere var dette gated på form-felt + kbd-editing — det var
        // halvveis. iOS-native mønster (keyboardDismissMode=.onDrag) gjelder
        // for all scroll med åpent tastatur. IS_TOUCH-gate → desktop aldri.
        if (!IS_TOUCH_DEVICE) return false;
        if (Date.now() < _kbdDismissGuardUntil) return false;
        var ae = document.activeElement;
        if (!ae || typeof isKeyboardOpeningElement !== 'function') return false;
        if (!isKeyboardOpeningElement(ae)) return false;
        return true;
    }
    function _kbdDismissBlur() {
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }

    // Mekanisme A: bruker-initiert scroll lukker tastatur (native iOS/Android-
    // mønster). touchmove (ikke scroll-event) er per definisjon bruker-initiert
    // — programmatisk scroll-into-view utløser scroll men ikke touchmove.
    document.addEventListener('touchstart', function(e) {
        if (e.touches && e.touches.length) _kbdTouchStartY = e.touches[0].clientY;
        _kbdScrollBlurred = false;
    }, { passive: true });
    document.addEventListener('touchmove', function(e) {
        if (_kbdScrollBlurred) return;
        if (!e.touches || !e.touches.length) return;
        if (!_kbdDismissArmed()) return;
        if (Math.abs(e.touches[0].clientY - _kbdTouchStartY) <= 12) return;
        // Ekte scroll-gest: blur én gang per gest (ikke per frame — derfor
        // lytter koden bevisst ikke på visualViewport.scroll).
        _kbdScrollBlurred = true;
        _kbdDismissBlur();
    }, { passive: true });

    // Mekanisme B: tapp på hva som helst som ikke er et tekstfelt lukker
    // tastatur. Detekterer tap vs drag via bevegelse mellom pointerdown og
    // pointerup. Blur fires KUN ved pointerup hvis bevegelsen var liten
    // (= ekte tap, ikke drag). Hvis brukeren drar fingeren, lar vi
    // touchmove-handleren (scroll-dismiss) ta over — uten denne distinksjonen
    // ville pointerdown blurre umiddelbart og 30ms-grace-timeren ville fjerne
    // kbd-editing mid-drag → scroller bytter mid-touch → Android avbryter
    // scroll-gesten (= "knapp kan ikke brukes til å scrolle"-buggen).
    var _pdArmed = false;
    var _pdStartX = 0, _pdStartY = 0;
    document.addEventListener('pointerdown', function(e) {
        _pdArmed = false;
        if (!_kbdDismissArmed()) return;
        // Tappet et annet tekstfelt → ikke gjør noe; la native fokus-flytt +
        // focusin/focusout håndtere det (unngår blur→refokus-blink).
        if (isKeyboardOpeningElement(e.target)) return;
        _pdArmed = true;
        _pdStartX = (typeof e.clientX === 'number') ? e.clientX : 0;
        _pdStartY = (typeof e.clientY === 'number') ? e.clientY : 0;
    });
    document.addEventListener('pointerup', function(e) {
        if (!_pdArmed) return;
        _pdArmed = false;
        var dx = Math.abs(((typeof e.clientX === 'number') ? e.clientX : 0) - _pdStartX);
        var dy = Math.abs(((typeof e.clientY === 'number') ? e.clientY : 0) - _pdStartY);
        // Bevegelse < 12px = ekte tap. Større = drag → scroll-dismiss-pathen
        // (via touchmove) har allerede tatt over (eller brukeren ville bare
        // scrolle uten å dismiss-e tastaturet).
        if (dx < 12 && dy < 12) {
            _kbdDismissBlur();
        }
    });
    document.addEventListener('pointercancel', function() { _pdArmed = false; });

    // === Idiotsikker bakgrunns-scroll-lås for popuper ===
    // Browser-agnostisk: uavhengig av :has()-støtte (Firefox), CSS position-
    // quirks, service-worker-cache og tastatur-state. Når en popup/overlay er
    // åpen blokkeres touch-scroll for ALT som ikke er popupens egen scroll-
    // flate. Standard modal-oppførsel. Påvirker ikke tapping (touchmove ≠ tap;
    // ingen stopPropagation) og ikke scroll inni popup-innholdet (de har alt
    // overscroll-behavior:contain så de chainer ikke ut). Egen condition fra
    // tastatur-dismiss-lytteren (den krever fokus i #view-form-felt + ingen
    // popup) → ingen konflikt.
    var _POPUP_ACTIVE_SELECTOR = '.confirm-modal.active, .spec-popup-backdrop.active, .fakturaadresse-popup-backdrop.active, .picker-overlay.active';
    // KUN faktiske interne scrollere — IKKE hele sheet-elementene (.spec-popup-
    // sheet o.l.). Hvis vi tillot native scroll på hele sheeten ville touch på
    // header/padding/knapp-området (som ikke har overflow:auto) la browseren
    // finne noe annet å scrolle (visual viewport / sheet-transform) → popupen
    // ble dratt opp og bort. Disse interne scrollerne har overscroll-behavior:
    // contain så de chainer aldri ut.
    var _POPUP_SCROLLABLE_SELECTOR = '.spec-popup-body, .confirm-modal-content, .fakturaadresse-popup-body, .picker-overlay-list, .modal-body';
    document.addEventListener('touchmove', function(e) {
        if (!document.querySelector(_POPUP_ACTIVE_SELECTOR)) return;
        var tgt = e.target;
        // Scroll inni popupens egen scrollflate (liste/innhold) → tillat.
        if (tgt && tgt.closest && tgt.closest(_POPUP_SCROLLABLE_SELECTOR)) return;
        // Alt annet (sheet-header/padding/knapper, backdrop-dim, skjema bak,
        // toolbar) → blokker fullstendig.
        if (e.cancelable) e.preventDefault();
    }, { passive: false, capture: true });

    // Initial sync — håndterer edge case der tastatur allerede er åpent ved
    // sidelasting (f.eks. retur til PWA der state ikke er nullstilt)
    scheduleApply();

    // Load dropdown options for materials/units and plans
    getDropdownOptions();
    loadPlanOptions();

    // Load required field settings and update indicators
    getRequiredSettings().then(function(data) {
        cachedRequiredSettings = data;
        updateRequiredIndicators();
    });

    // View is already activated by inline script in HTML.
    // Here we only do data-specific init based on hash.
    const hash = window.location.hash.slice(1);
    var formTypeFromSession = sessionStorage.getItem('firesafe_form_type');
    if (hash === 'skjema' || (!hash && formTypeFromSession)) {
        document.getElementById('form-header-title').textContent = t('form_title');
        const wasSent = sessionStorage.getItem('firesafe_current_sent') === '1';
        if (wasSent) {
            document.getElementById('sent-banner').style.display = 'block';
            var btnFormSent = document.getElementById('btn-form-sent');
            if (btnFormSent) btnFormSent.style.display = 'none';
        }
        updateToolbarState();
    } else if (hash === 'hent') {
        // Trigger background Firestore refresh for saved forms list
        if (currentUser && db) {
            Promise.all([getSavedForms(), getSentForms()]).then(function([savedResult, sentResult]) {
                if (Date.now() - _lastLocalSaveTs < 5000) return;
                _savedLastDoc = savedResult.lastDoc;
                _sentLastDoc = sentResult.lastDoc;
                _savedHasMore = savedResult.hasMore;
                _sentHasMore = sentResult.hasMore;
                safeSetItem(STORAGE_KEY, JSON.stringify(savedResult.forms.slice(0, 50)));
                safeSetItem(ARCHIVE_KEY, JSON.stringify(sentResult.forms.slice(0, 50)));
                window.loadedForms = _mergeAndDedup(
                    savedResult.forms.map(f => ({ ...f, _isSent: false })),
                    sentResult.forms.map(f => ({ ...f, _isSent: true }))
                );
                if (document.body.classList.contains('saved-modal-open')) {
                    renderSavedFormsList(window.loadedForms, false, _savedHasMore || _sentHasMore);
                }
            }).catch(function(e) { console.error('Refresh saved forms:', e); });
        }
        // Show cached data immediately
        var cachedSaved = safeParseJSON(STORAGE_KEY, []);
        var cachedSent = safeParseJSON(ARCHIVE_KEY, []);
        renderSavedFormsList(_mergeAndDedup(
            cachedSaved.map(f => ({ ...f, _isSent: false })),
            cachedSent.map(f => ({ ...f, _isSent: true }))
        ));
        var savedTab = sessionStorage.getItem('firesafe_hent_tab') || 'own';
        switchHentTab(savedTab);
        updateToolbarState();
    } else if (hash === 'settings' || hash.indexOf('settings/') === 0) {
        var subPage = hash.split('/')[1] || sessionStorage.getItem('firesafe_settings_page');
        if (subPage) {
            showSettingsPage(subPage);
        } else {
            showSettingsMenu();
        }
        updateToolbarState();
    } else if (hash === 'calc') {
        showView('calculator-modal');
        document.body.classList.add('calculator-modal-open');
        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'service-view-open');
        document.querySelector('.calc-section').style.display = '';
        document.querySelectorAll('.calc-page').forEach(function(p) { p.style.display = 'none'; });
        updateToolbarState();
    } else if (hash === 'kappe') {
        showView('kappe-view');
        document.body.classList.add('kappe-view-open');
        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'calculator-modal-open', 'service-view-open');
        var kappeCurrent = sessionStorage.getItem('firesafe_kappe_current');
        if (kappeCurrent) {
            try {
                var kData = JSON.parse(kappeCurrent);
                _kappeCurrentId = kData.id || null;
                setKappeFormData(kData);
                var wasSentK = sessionStorage.getItem('firesafe_kappe_sent') === '1';
                // Hvis ikke sendt: oppdater Dato til dagens ved reload
                if (!wasSentK) _setKappeDatoToday();
                document.getElementById('kappe-sent-banner').style.display = wasSentK ? 'block' : 'none';
                document.getElementById('btn-kappe-sent').style.display = wasSentK ? 'none' : '';
                _kappeLastSavedData = getKappeFormDataSnapshot();
            } catch(e) {}
        }
        var linesContainer = document.getElementById('kappe-lines');
        if (linesContainer && linesContainer.children.length === 0) {
            linesContainer.appendChild(createKappeLineCard({}, true));
            renumberKappeLines();
            updateKappeDeleteStates();
        }
        renderKappeStiftRows();
    } else if (hash === 'service') {
        // Show service view
        showView('service-view');
        document.body.classList.add('service-view-open');
        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'calculator-modal-open');
        // Gjenopprett modus (inntak/uttak) — body-klasse + toggle holdes i synk via _setServicebilMode
        var savedMode = sessionStorage.getItem('firesafe_servicebil_mode') || 'uttak';
        _setServicebilMode(savedMode);
        // Restore from session if available
        var serviceCurrent = sessionStorage.getItem('firesafe_service_current');
        if (serviceCurrent) {
            try {
                var sData = JSON.parse(serviceCurrent);
                _serviceCurrentId = sData.id || null;
                setServiceFormData(sData);
                var wasSent = sessionStorage.getItem('firesafe_service_sent') === '1';
                // Hvis ikke sendt: oppdater Uke til dagens uke ved reload (entry-datoer bevares)
                if (!wasSent) {
                    var srvUke = document.getElementById('service-uke');
                    if (srvUke) srvUke.value = String(getWeekNumber(new Date()));
                }
                document.getElementById('service-sent-banner').style.display = wasSent ? 'block' : 'none';
                document.getElementById('btn-service-sent').style.display = wasSent ? 'none' : '';
                // Reset kun signatur ved ny sesjon — entry-datoer representerer når
                // jobben ble utført (historisk) og skal IKKE overskrives.
                document.getElementById('service-signatur').value = '';
                window._serviceSignaturePaths = [];
                var srvPreviewImg = document.getElementById('service-signature-preview-img');
                if (srvPreviewImg) { srvPreviewImg.style.display = 'none'; srvPreviewImg.src = ''; }
                var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
                if (srvPlaceholder) srvPlaceholder.style.display = '';
                // Baseline ETTER reset, ikke rå sessionStorage-streng
                _serviceLastSavedData = getServiceFormDataSnapshot();
            } catch(e) {}
        }
        // Ensure at least 1 entry card exists
        var entriesContainer = document.getElementById('service-entries');
        if (entriesContainer && entriesContainer.children.length === 0) {
            entriesContainer.appendChild(createServiceEntryCard({}, true));
            renumberServiceEntries();
            updateServiceDeleteStates();
        }
    } else if (!hash || hash === '') {
        window.loadedTemplates = safeParseJSON(TEMPLATE_KEY, []);
        updateToolbarState();
        // Background refresh
        if (currentUser && db) {
            getTemplates().then(function(result) {
                _templateLastDoc = result.lastDoc;
                _templateHasMore = result.hasMore;
                window.loadedTemplates = result.forms;
                safeSetItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
            }).catch(function(e) { console.error('Refresh templates:', e); });
        }
    }
});

// Handle browser back/forward buttons
var _suppressHashGuard = false;

function _applyHashNavigation(hash) {
    // Don't close modals for hent/settings - those functions handle it themselves
    if (hash === 'hent') {
        if (!document.body.classList.contains('saved-modal-open')) showSavedForms();
    } else if (hash === 'settings' || hash.indexOf('settings/') === 0) {
        if (!document.body.classList.contains('settings-modal-open')) {
            showSettingsModal();
        }
        var subPage = hash.split('/')[1];
        if (subPage) {
            showSettingsPage(subPage);
        } else {
            showSettingsMenu();
        }
    } else if (hash === 'skjema') {
        showView('view-form');
        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
        document.getElementById('form-header-title').textContent = t('form_title');
        updateToolbarState();
    } else if (hash === 'service') {
        if (!document.body.classList.contains('service-view-open')) {
            showView('service-view');
            document.body.classList.add('service-view-open');
            document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'calculator-modal-open');
        }
        // Sørg for at mode-body-klasse + toggle alltid matcher persistert/aktiv modus
        if (!document.body.classList.contains('servicebil-inntak-mode')
            && !document.body.classList.contains('servicebil-uttak-mode')) {
            var sm = sessionStorage.getItem('firesafe_servicebil_mode') || 'uttak';
            _setServicebilMode(sm);
        }
    } else if (hash === 'kappe') {
        if (!document.body.classList.contains('kappe-view-open')) {
            showView('kappe-view');
            document.body.classList.add('kappe-view-open');
            document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'calculator-modal-open', 'service-view-open');
        }
    } else if (hash === 'calc') {
        if (!document.body.classList.contains('calculator-modal-open')) {
            _showCalculatorDirectly();
        }
    } else {
        // No hash = home = template modal
        showTemplateModal();
    }
}

// Mapper fra hash-verdi til hvilken .view som skal være aktiv. Brukes for å
// avgjøre om en hashchange faktisk bytter view eller bare synkroniserer URL-en.
function _viewIdForHash(hash) {
    if (hash === 'hent') return 'saved-modal';
    if (hash === 'settings' || hash.indexOf('settings/') === 0) return 'settings-modal';
    if (hash === 'skjema') return 'view-form';
    if (hash === 'service') return 'service-view';
    if (hash === 'kappe') return 'kappe-view';
    if (hash === 'calc') return 'calculator-modal';
    return 'template-modal';
}

// Lukker alle åpne overlays/popups så de ikke blir hengende ved browser-navigering
// (swipe-back / popstate / programmatisk hash-bytte). Header/top-bar kan ellers
// bli skjult av body-klasser som picker-active/signature-active/preview-active.
function _dismissOverlaysOnNavigation() {
    if (document.body.classList.contains('picker-active') && typeof closePickerOverlay === 'function') {
        closePickerOverlay();
    }
    if (document.body.classList.contains('signature-active') && typeof cleanupSignatureOverlay === 'function') {
        cleanupSignatureOverlay();
    }
    if (document.body.classList.contains('preview-active') && typeof closePreview === 'function') {
        closePreview();
    }
    var specPopup = document.getElementById('spec-popup');
    if (specPopup && specPopup.classList.contains('active') && typeof closeSpecPopup === 'function') {
        closeSpecPopup();
    }
    var faktura = document.getElementById('fakturaadresse-popup');
    if (faktura) faktura.classList.remove('active');
    var actionPopup = document.getElementById('action-popup');
    if (actionPopup) actionPopup.classList.remove('active');
    var kappePicker = document.getElementById('kappe-product-picker-overlay');
    if (kappePicker) kappePicker.classList.remove('active');
}

window.addEventListener('hashchange', function() {
    if (!currentUser) return; // Ikke naviger uten innlogging
    var hash = window.location.hash.slice(1);

    var currentView = document.querySelector('.view.active');
    var currentId = currentView ? currentView.id : null;
    // Hvis hashen peker til samme view som allerede er aktivt, er det bare URL-sync
    // (f.eks. når openNewServiceForm setter hash='service' mens service-view ALLEREDE er aktiv).
    // Da skal vi IKKE lukke overlays — det river ned auto-åpnet picker o.l.
    var changingView = _viewIdForHash(hash) !== currentId;

    // If we just rolled back or confirmed, apply without re-guarding
    if (_suppressHashGuard) {
        _suppressHashGuard = false;
        if (changingView) _dismissOverlaysOnNavigation();
        _applyHashNavigation(hash);
        return;
    }

    // Detect if this hashchange leaves a form view with unsaved data
    var leavingFormView = (currentId === 'view-form' && hash !== 'skjema')
        || (currentId === 'service-view' && hash !== 'service')
        || (currentId === 'kappe-view' && hash !== 'kappe');

    if (leavingFormView && hasUnsavedChanges()) {
        var previousHash = currentId === 'view-form' ? 'skjema' : (currentId === 'kappe-view' ? 'kappe' : 'service');
        var newHash = hash;
        // Rollback URL silently (replaceState does NOT fire hashchange)
        history.replaceState(null, '', '#' + previousHash);
        showConfirmModal(t('unsaved_warning'), function() {
            // User confirmed — re-apply the requested navigation.
            // Setting window.location.hash fires hashchange; use the flag to bypass
            // the guard on that re-entry.
            if (newHash) {
                _suppressHashGuard = true;
                window.location.hash = newHash;
            } else {
                // Going home (no hash): replaceState doesn't fire hashchange, apply directly
                history.replaceState(null, '', window.location.pathname);
                _dismissOverlaysOnNavigation();
                if (currentId === 'service-view' && typeof closeServiceView === 'function') closeServiceView();
                if (currentId === 'kappe-view' && typeof closeKappeView === 'function') closeKappeView();
                _applyHashNavigation('');
            }
        }, t('btn_continue'), '#E8501A');
        return;
    }

    // Bare lukk overlays + view-cleanup når vi faktisk bytter view. Da oppfører
    // swipe-back seg som header-tilbakeknappen (navigateBack).
    if (changingView) {
        _dismissOverlaysOnNavigation();
        if (leavingFormView) {
            if (currentId === 'service-view' && typeof closeServiceView === 'function') closeServiceView();
            if (currentId === 'kappe-view' && typeof closeKappeView === 'function') closeKappeView();
        }
    }
    _applyHashNavigation(hash);
});

// ===== Calculator =====

// Multicollar formulas (derived from manufacturer data):
// - Segment pitch on strip: 15mm (2610mm roll / 174 segments)
// - Hinge circle radius = pipe_radius + segment_pitch (15mm)
// - Circumference at hinge circle = π × (d + 2 × 15) = π × (d + 30)
// - Segments = round(π(d + 30) / 15), minimum 15
// - Collars per roll: floor(174 / segments)
var MC_SEGMENT_PITCH = 15;     // mm per segment on flat strip
var MC_SEGMENTS_PER_ROLL = 174; // 2610mm / 15mm
var MC_MIN_SEGMENTS = 15;

function mcCalcSegments(diameter) {
    var n = Math.round(Math.PI * (diameter + 2 * MC_SEGMENT_PITCH) / MC_SEGMENT_PITCH);
    return Math.max(MC_MIN_SEGMENTS, n);
}

function mcCalcClips(diameter) {
    if (diameter >= 200) {
        var regular = Math.ceil(diameter / 200);
        var large = diameter <= 250 ? 5 : Math.ceil(diameter / 50);
        return regular + ' <span class="calc-clip-large">(+' + large + 'L)</span>';
    }
    return Math.max(2, Math.ceil(diameter / 48));
}

function showCalculator() {
    if (isOnFormPage() && hasUnsavedChanges()) {
        showConfirmModal(t('unsaved_warning'), _showCalculatorDirectly, t('btn_continue'), '#E8501A');
        return;
    }
    _showCalculatorDirectly();
}

function _showCalculatorDirectly() {
    closeAllModals();
    window.location.hash = 'calc';
    showView('calculator-modal');
    document.body.classList.add('calculator-modal-open');
    // Show menu, hide calc pages
    document.querySelector('.calc-section').style.display = '';
    document.querySelectorAll('.calc-page').forEach(function(p) { p.style.display = 'none'; });
    var mb = document.querySelector('#calculator-modal .modal-body');
    if (mb) mb.style.overflow = '';
    if (typeof _swStopTicker === 'function') _swStopTicker();
    updateToolbarState();
}

function showCalcPage(page) {
    document.querySelector('.calc-section').style.display = 'none';
    document.querySelectorAll('.calc-page').forEach(function(p) { p.style.display = 'none'; });
    var pageEl = document.getElementById('calc-page-' + page);
    if (pageEl) pageEl.style.display = '';
    var _calcMb = document.querySelector('#calculator-modal .modal-body');
    if (_calcMb) _calcMb.style.overflow = '';
    // Update header
    var header = document.querySelector('#calculator-modal .modal-header span');
    if (page === 'multicollar') {
        header.textContent = 'Multicollar';
        var input = document.getElementById('calc-mc-diameter');
        if (input) { input.value = ''; input.focus(); }
        document.getElementById('calc-mc-result').style.display = 'none';
        document.querySelectorAll('#calc-page-multicollar .calc-table-highlight').forEach(function(r) {
            r.classList.remove('calc-table-highlight');
        });
    } else if (page === 'brannpakning') {
        header.textContent = t('calc_bp_title');
        bpReset();
    } else if (page === 'brannplate') {
        header.textContent = t('calc_plate_title');
        bplReset();
    } else if (page === 'lysaapning') {
        header.textContent = t('calc_la_title');
        document.getElementById('la-sections').innerHTML = '';
        _laSectionCount = 0;
        laAddSection();
    } else if (page === 'isostift') {
        header.textContent = t('calc_iso_title');
        var mb = document.querySelector('#calculator-modal .modal-body');
        if (mb) mb.style.overflow = 'hidden';
        calcIsoStift();
    } else if (page === 'stopwatch') {
        header.textContent = t('calc_sw_title');
        _swRenderList();
        _swStartTicker();
    }
    if (page !== 'stopwatch') _swStopTicker();
}

// ===== Isolering stift-kalkulator =====

function showProfileInfo() {
    var m = document.getElementById('profile-info-modal');
    if (m) m.classList.add('active');
}
function closeProfileInfo(e) {
    if (e && e.target !== document.getElementById('profile-info-modal')) return;
    var m = document.getElementById('profile-info-modal');
    if (m) m.classList.remove('active');
}

function calcIsoStift() {
    var w = parseInt(document.getElementById('iso-width').value, 10) || 0;
    var h = parseInt(document.getElementById('iso-height').value, 10) || 0;
    var profile = document.getElementById('iso-profile').value;
    var method = document.getElementById('iso-method').value;
    var canvas = document.getElementById('iso-stift-canvas');
    var resultEl = document.getElementById('iso-stift-result');

    var thickness = parseInt(document.getElementById('iso-thickness').value, 10) || 0;

    if (w < 50 || h < 50) {
        var ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth * 2;
        canvas.height = 200;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resultEl.innerHTML = '<div class="iso-result-empty">' + t('iso_enter_dims') + '</div>';
        return;
    }

    var data = _calcPinPositions(w, h, profile, method, thickness);
    _drawIsoCanvas(canvas, data, w, h, profile, thickness, method);

    var ruleCC = (method === 'pins') ? 300 : 150;
    var isHollowResult = (profile === 'rhs');

    var line2 = '<b>' + data.pins.length + '</b> ' + (method === 'pins' ? t('iso_pins_label') : t('iso_screws_label')) +
        ' &nbsp;|&nbsp; c/c: <b>' + Math.round(data.spacingX) + ' × ' + Math.round(data.spacingY) + ' mm</b>';
    var showEdgeX = Math.round(data.edgeDistX || data.edgeDist);
    var showEdgeY = Math.round(data.edgeDistY || data.edgeDist);
    var maxAllowedEdge = (method === 'pins' && isHollowResult) ? 75 : null;
    var edgeOver = (maxAllowedEdge !== null && (showEdgeX > maxAllowedEdge || showEdgeY > maxAllowedEdge));
    var edgeStyle = edgeOver ? ' style="color:#d23"' : '';
    var edgeText = (showEdgeX === showEdgeY) ? showEdgeX + ' mm' : showEdgeX + ' × ' + showEdgeY + ' mm';
    line2 += ' &nbsp;|&nbsp; ' + t('iso_edge') + ': <b' + edgeStyle + '>' + edgeText + '</b>';

    // Rad 3: regler
    var line3;
    if (method === 'pins') {
        line3 = 'c/c ≤ 300 mm &nbsp;|&nbsp; ' + t('iso_edge') + ' ≤ 75 mm';
    } else {
        line3 = 'c/c ≤ 150 × 200 mm &nbsp;|&nbsp; ' + t('iso_screw_edge_note');
    }

    resultEl.innerHTML = line2 + '<div class="iso-result-spec">' + line3 + '</div>';
}

function _calcPinPositions(width, height, profile, method, thickness) {
    thickness = thickness || 0;
    // Profilgrupper: RHS/HSQ = solid overflate, resten = I/U/L-profiler (stifter ved flens)
    var isHollow = (profile === 'rhs');

    var maxEdge, maxCC, maxRowCC;
    if (method === 'screws') {
        maxEdge = (thickness > 0) ? Math.floor(thickness / 2) : 25;
        maxCC = 150;
        maxRowCC = 200;
    } else if (isHollow) {
        maxEdge = 75;
        maxCC = 300;
        maxRowCC = 300;
    } else {
        // I-profiler (HEA/HEB/IPE/INP), U-profil (UPE), L-profil, TRP
        maxEdge = 10;
        maxCC = 300;
        maxRowCC = 300;
    }

    // Stålsone: flush på venstre/topp, overlapp (tykkelse) på høyre/bunn
    // Stifter kan kun plasseres der det er stål bak: x=0 til x=(width-thickness)
    var steelW = (method === 'pins' && thickness > 0) ? width - thickness : width;
    var steelH = (method === 'pins' && thickness > 0) ? height - thickness : height;
    if (steelW < 20) steelW = width;
    if (steelH < 20) steelH = height;

    // Stål-margin: hold stiften unna selve stål-kanten for sveise-stabilitet
    var steelMarginX = Math.min(maxEdge, Math.floor(steelW / 4));
    var steelMarginY = Math.min(maxEdge, Math.floor(steelH / 4));

    // Bredde: HUP/RHS sveisepinner måler kantavstand fra isolasjons-kant (panelets ytterkant).
    // I/U/L og skruer bruker gammel stål/flens-kant-logikk.
    var cols, edgeDistX, spacingX, firstColX;

    if (isHollow && method === 'pins') {
        if (width <= maxEdge * 2) {
            // én stift kan dekke begge isolasjons-kanter samtidig
            cols = 1;
            var pinX = width / 2;
            if (pinX > steelW - steelMarginX) pinX = steelW - steelMarginX;
            if (pinX < steelMarginX) pinX = Math.max(steelMarginX, steelW / 2);
            firstColX = pinX;
            edgeDistX = Math.max(pinX, width - pinX);
            spacingX = 0;
        } else {
            // multi-col: spred stiftene maksimalt innenfor stål-sonen (steelMargin på hver side)
            var leftPinX = steelMarginX;
            var rightPinX = steelW - steelMarginX;
            if (rightPinX > leftPinX) {
                var span = rightPinX - leftPinX;
                cols = Math.max(2, Math.ceil(span / maxCC) + 1);
                spacingX = span / (cols - 1);
                firstColX = leftPinX;
                edgeDistX = Math.max(leftPinX, width - rightPinX);
            } else {
                cols = 1;
                firstColX = leftPinX;
                edgeDistX = Math.max(leftPinX, width - leftPinX);
                spacingX = 0;
            }
        }
    } else {
        var innerW = steelW - 2 * steelMarginX;
        if (innerW <= 0 || steelW <= maxEdge * 2) {
            cols = 1;
            firstColX = steelW / 2;
            edgeDistX = steelW / 2;
            spacingX = 0;
        } else {
            cols = Math.max(2, Math.ceil(innerW / maxCC) + 1);
            firstColX = steelMarginX;
            edgeDistX = steelMarginX;
            spacingX = innerW / (cols - 1);
        }
    }

    // Høyde: samme prinsipp som bredde
    var rows, edgeDistY, spacingY, firstRowY;

    if (isHollow && method === 'pins') {
        if (height <= maxEdge * 2) {
            rows = 1;
            var pinY = height / 2;
            if (pinY > steelH - steelMarginY) pinY = steelH - steelMarginY;
            if (pinY < steelMarginY) pinY = Math.max(steelMarginY, steelH / 2);
            firstRowY = pinY;
            edgeDistY = Math.max(pinY, height - pinY);
            spacingY = 0;
        } else {
            // multi-row: spred radene maksimalt innenfor stål-sonen
            var topPinY = steelMarginY;
            var botPinY = steelH - steelMarginY;
            if (botPinY > topPinY) {
                var spanY = botPinY - topPinY;
                rows = Math.max(2, Math.ceil(spanY / maxRowCC) + 1);
                spacingY = spanY / (rows - 1);
                firstRowY = topPinY;
                edgeDistY = Math.max(topPinY, height - botPinY);
            } else {
                rows = 1;
                firstRowY = topPinY;
                edgeDistY = Math.max(topPinY, height - topPinY);
                spacingY = 0;
            }
        }
    } else {
        var innerH = steelH - 2 * steelMarginY;
        if (innerH <= 0 || steelH <= maxEdge * 2) {
            rows = 1;
            firstRowY = steelH / 2;
            edgeDistY = steelH / 2;
            spacingY = 0;
        } else {
            rows = Math.max(2, Math.ceil(innerH / maxRowCC) + 1);
            firstRowY = steelMarginY;
            edgeDistY = steelMarginY;
            spacingY = innerH / (rows - 1);
        }
    }

    var edgeDist = maxEdge;

    var pins = [];

    if (!isHollow && method === 'pins') {
        var rightPinXX = steelW - firstColX;
        if (rightPinXX < firstColX) rightPinXX = firstColX;
        for (var r = 0; r < rows; r++) {
            pins.push({ x: firstColX, y: firstRowY + r * spacingY });
            if (rightPinXX > firstColX) pins.push({ x: rightPinXX, y: firstRowY + r * spacingY });
        }
        spacingX = (rightPinXX > firstColX) ? rightPinXX - firstColX : 0;
    } else {
        for (var r = 0; r < rows; r++) {
            var y = firstRowY + r * spacingY;
            for (var c = 0; c < cols; c++) {
                pins.push({ x: firstColX + c * spacingX, y: y });
            }
        }
    }

    return { pins: pins, spacingX: spacingX, spacingY: spacingY, edgeDist: edgeDist, edgeDistX: edgeDistX, edgeDistY: edgeDistY, cols: cols, rows: rows };
}


function _drawIsoCanvas(canvas, data, plateW, plateH, profile, thickness, method) {
    thickness = thickness || 0;
    var dpr = window.devicePixelRatio || 1;
    var container = canvas.parentElement;
    var cw = container ? container.clientWidth : canvas.offsetWidth;
    if (cw < 100) cw = 320;
    var paddingLeft = 55;
    var paddingRight = 50;
    var paddingTop = 55;
    var paddingBottom = (thickness > 0) ? 38 : 24;
    var padding = paddingTop;
    var maxDrawW = cw - paddingLeft - paddingRight;
    // Dynamisk maks-høyde: viewport minus header(44) + kontroller(~80) + resultat(~30) + toolbar(67) + margins(60)
    // canvas-padding (2*padding) trekkes fra separat i maxDrawH-formelen
    var usedH = 44 + 80 + 30 + 67 + 60;
    var maxDrawH = Math.max(150, window.innerHeight - usedH - paddingTop - paddingBottom);
    var scaleX = maxDrawW / plateW;
    var scaleY = maxDrawH / plateH;
    var scale = Math.min(scaleX, scaleY);
    var drawW = plateW * scale;
    var drawH = plateH * scale;
    var ch = drawH + paddingTop + paddingBottom;

    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    var ox = paddingLeft + (maxDrawW - drawW) / 2;
    var oy = paddingTop;

    // Steg/passbit-sone for I/U-profiler
    var isHollowDraw = (profile === 'rhs');
    if (!isHollowDraw && data.pins.length > 0 && method === 'screws') {
        // Skruer: vis passbit-sone (der skruene festes)
        var steelWp = (thickness > 0) ? plateW - thickness : plateW;
        var pzLeft = data.edgeDist + 1;
        var pzRight = steelWp - data.edgeDist - 1;
        if (pzRight > pzLeft) {
            ctx.fillStyle = 'rgba(180,210,160,0.35)';
            ctx.fillRect(ox + pzLeft * scale, oy, (pzRight - pzLeft) * scale, drawH);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = '#8aad70';
            ctx.lineWidth = 1;
            ctx.strokeRect(ox + pzLeft * scale, oy, (pzRight - pzLeft) * scale, drawH);
            ctx.setLineDash([]);
            ctx.fillStyle = '#7a9a60';
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.save();
            ctx.translate(ox + (pzLeft + pzRight) / 2 * scale, oy + drawH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Passbit', 0, 4);
            ctx.restore();
        }
    }
    if (!isHollowDraw && data.pins.length > 0 && method !== 'screws') {
        var steelW = (thickness > 0) ? plateW - thickness : plateW;
        var zoneLeft = data.edgeDist + 1;
        var zoneRight = steelW - data.edgeDist - 1;
        if (zoneRight > zoneLeft) {
            ctx.fillStyle = '#f5f0f0';
            ctx.fillRect(ox + zoneLeft * scale, oy, (zoneRight - zoneLeft) * scale, drawH);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = '#d0c0c0';
            ctx.lineWidth = 1;
            ctx.strokeRect(ox + zoneLeft * scale, oy, (zoneRight - zoneLeft) * scale, drawH);
            ctx.setLineDash([]);
            ctx.fillStyle = '#baa';
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.save();
            ctx.translate(ox + (zoneLeft + zoneRight) / 2 * scale, oy + drawH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(t('iso_steg_zone'), 0, 4);
            ctx.restore();
        }
    }

    // Overlapp-soner (tykkelse) — markert med skravering
    if (thickness > 0) {
        var tW = thickness * scale;
        var tH = thickness * scale;
        ctx.fillStyle = 'rgba(255,200,150,0.3)';
        // Høyre side overlapp
        if (tW > 0 && tW < drawW) {
            ctx.fillRect(ox + drawW - tW, oy, tW, drawH);
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#E8501A';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(ox + drawW - tW, oy);
            ctx.lineTo(ox + drawW - tW, oy + drawH);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        // Bunn overlapp
        if (tH > 0 && tH < drawH) {
            ctx.fillStyle = 'rgba(255,200,150,0.3)';
            ctx.fillRect(ox, oy + drawH - tH, drawW, tH);
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#E8501A';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(ox, oy + drawH - tH);
            ctx.lineTo(ox + drawW, oy + drawH - tH);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // Plate-rektangel
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, drawW, drawH);

    // Stifter — skalér radius med antall
    var pinR = Math.max(2, Math.min(5, Math.min(drawW, drawH) / (Math.max(data.cols, data.rows) * 6)));
    ctx.fillStyle = '#E8501A';
    for (var i = 0; i < data.pins.length; i++) {
        var px = ox + data.pins[i].x * scale;
        var py = oy + data.pins[i].y * scale;
        ctx.beginPath();
        ctx.arc(px, py, pinR, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(0.5, pinR * 0.3);
        ctx.stroke();
    }

    // Mål-annotasjoner
    var aFont = Math.max(7, Math.min(10, Math.min(paddingLeft, paddingTop) * 0.22));
    ctx.font = aFont + 'px Arial';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';

    if (data.pins.length > 0) {
        var edX = data.edgeDistX || data.edgeDist;
        var edY = data.edgeDistY || data.edgeDist;
        var firstPinX = ox + edX * scale;
        var firstPinY = oy + edY * scale;

        // Venstre: kantavstand
        _isoDrawDim(ctx, ox - 16, oy, ox - 16, firstPinY, Math.round(edY));
        // Venstre: c/c vertikal
        if (data.rows > 1 && data.spacingY > 0) {
            var y2v = oy + (edY + data.spacingY) * scale;
            _isoDrawDim(ctx, ox - 36, firstPinY, ox - 36, y2v, Math.round(data.spacingY));
        }
        // Topp: kantavstand
        _isoDrawDim(ctx, ox, oy - 14, firstPinX, oy - 14, Math.round(edX));
        // Topp: c/c horisontal
        if (data.cols > 1 && data.spacingX > 0) {
            var x2v = ox + (edX + data.spacingX) * scale;
            _isoDrawDim(ctx, firstPinX, oy - 34, x2v, oy - 34, Math.round(data.spacingX));
        }
    }

    // Dimensjoner — bunn og høyre
    var dFont = Math.max(8, Math.min(11, paddingBottom * 0.4));
    ctx.font = 'bold ' + dFont + 'px Arial';
    ctx.textAlign = 'center';

    if (thickness > 0) {
        var steelWd = plateW - thickness;
        var steelHd = plateH - thickness;
        ctx.fillStyle = '#555';
        ctx.fillText(plateW + ' mm', ox + drawW / 2, oy + drawH + dFont + 4);
        ctx.fillStyle = '#E8501A';
        ctx.fillText(steelWd + ' mm', ox + drawW / 2, oy + drawH + dFont * 2 + 6);
        ctx.fillStyle = '#555';
        ctx.save();
        ctx.translate(ox + drawW + dFont * 2 + 6, oy + drawH / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(plateH + ' mm', 0, 0);
        ctx.restore();
        ctx.fillStyle = '#E8501A';
        ctx.save();
        ctx.translate(ox + drawW + dFont + 4, oy + drawH / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(steelHd + ' mm', 0, 0);
        ctx.restore();
        // Legend øverst til høyre i canvas
        ctx.textAlign = 'right';
        ctx.font = '9px Arial';
        var lx = cw - 8;
        var ly = 6;
        ctx.fillStyle = '#555';
        ctx.fillRect(lx - 36, ly, 6, 6);
        ctx.fillText('Plate', lx, ly + 6);
        ctx.fillStyle = '#E8501A';
        ctx.fillRect(lx - 36, ly + 12, 6, 6);
        ctx.fillText('Stål', lx, ly + 18);
    } else {
        ctx.fillStyle = '#555';
        ctx.fillText(plateW + ' mm', ox + drawW / 2, oy + drawH + dFont + 4);
        ctx.save();
        ctx.translate(ox + drawW + dFont + 4, oy + drawH / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(plateH + ' mm', 0, 0);
        ctx.restore();
    }
}

function _isoDrawDim(ctx, x1, y1, x2, y2, val) {
    ctx.beginPath();
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.7;
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    var isH = Math.abs(y1 - y2) < 2;
    ctx.beginPath();
    if (isH) {
        ctx.moveTo(x1, y1 - 3); ctx.lineTo(x1, y1 + 3);
        ctx.moveTo(x2, y2 - 3); ctx.lineTo(x2, y2 + 3);
    } else {
        ctx.moveTo(x1 - 3, y1); ctx.lineTo(x1 + 3, y1);
        ctx.moveTo(x2 - 3, y2); ctx.lineTo(x2 + 3, y2);
    }
    ctx.stroke();
    ctx.fillStyle = '#666';
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (isH) {
        ctx.fillText(val, mx, my - 3);
    } else {
        ctx.save();
        ctx.translate(mx - 4, my);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(val, 0, 0);
        ctx.restore();
    }
}


// ===== Stoppeklokker (flere parallelle) =====
var _SW_KEY = 'firesafe_stopwatches';
var _SW_KEY_LEGACY = 'firesafe_stopwatch';
var _swTickerId = null;

function _swLoad() {
    try {
        var raw = localStorage.getItem(_SW_KEY);
        if (raw) {
            var arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr.map(_swNormalize).filter(Boolean);
        }
        // Migrer fra gammel single-watch-key hvis den finnes
        var legacyRaw = localStorage.getItem(_SW_KEY_LEGACY);
        if (legacyRaw) {
            var legacy = JSON.parse(legacyRaw);
            var migrated = [{
                id: _swNewId(),
                label: 'Bestilling 1',
                startedAt: typeof legacy.startedAt === 'number' ? legacy.startedAt : null,
                accumulatedMs: typeof legacy.accumulatedMs === 'number' ? legacy.accumulatedMs : 0,
                isRunning: !!legacy.isRunning
            }];
            _swSave(migrated);
            try { localStorage.removeItem(_SW_KEY_LEGACY); } catch (e) {}
            return migrated;
        }
    } catch (e) {}
    return [];
}

function _swNormalize(w) {
    if (!w || typeof w !== 'object') return null;
    return {
        id: w.id || _swNewId(),
        label: typeof w.label === 'string' ? w.label : '',
        startedAt: typeof w.startedAt === 'number' ? w.startedAt : null,
        accumulatedMs: typeof w.accumulatedMs === 'number' ? w.accumulatedMs : 0,
        isRunning: !!w.isRunning
    };
}

function _swSave(list) {
    try { localStorage.setItem(_SW_KEY, JSON.stringify(list)); } catch (e) {}
    // Sync til Firebase så stoppeklokker er tilgjengelig på alle enheter
    // (per CLAUDE.md: brukerdata må persisteres begge steder). Dekker også
    // delete/clear siden alle skrive-flyter ender med _swSave.
    if (typeof enqueueUserDocSet === 'function') {
        enqueueUserDocSet('settings', 'stopwatches', { list: list || [] }, 'Sync stopwatches');
    }
}

function _swNewId() {
    return 'sw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _swElapsed(w) {
    var ms = w.accumulatedMs || 0;
    if (w.isRunning && w.startedAt) {
        var delta = Date.now() - w.startedAt;
        if (delta > 0) ms += delta;
    }
    return ms < 0 ? 0 : ms;
}

function _swFormat(ms) {
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return pad(h) + ':' + pad(m) + ':' + pad(s);
}

// Faktureringsformat: rundet opp til nærmeste halvtime.
// Returnerer norsk desimal: "0,5", "1", "1,5", "2", "2,5" …
function _swBilledHours(ms) {
    if (ms <= 0) return '0';
    var minutes = ms / 60000;
    var billed = Math.ceil(minutes / 30) * 30;
    var hours = billed / 60;
    if (hours === Math.floor(hours)) return String(hours);
    return String(Math.floor(hours)) + ',5';
}

function _swEscape(str) {
    return String(str).replace(/[&<>"']/g, function(c) {
        return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
}

function _swAnyRunning(list) {
    list = list || _swLoad();
    for (var i = 0; i < list.length; i++) if (list[i].isRunning) return true;
    return false;
}

function _swUpdateIndicator(list) {
    document.body.classList.toggle('stopwatch-running', _swAnyRunning(list));
}

function _swRenderList() {
    var container = document.getElementById('sw-list');
    var empty = document.getElementById('sw-empty');
    var clearBtn = document.getElementById('sw-clear-all-btn');
    if (!container) return;
    var list = _swLoad();
    if (clearBtn) clearBtn.hidden = list.length < 2;
    if (!list.length) {
        container.innerHTML = '';
        if (empty) empty.style.display = '';
        _swUpdateIndicator(list);
        return;
    }
    if (empty) empty.style.display = 'none';
    var html = '';
    for (var i = 0; i < list.length; i++) {
        var w = list[i];
        var running = w.isRunning;
        var elapsedMs = _swElapsed(w);
        var idleClass = (!running && elapsedMs === 0) ? ' sw-idle' : '';
        html += '<div class="sw-card' + (running ? ' sw-card-running' : '') + '" data-id="' + w.id + '">' +
            '<div class="sw-card-row sw-card-row-label">' +
                '<label class="sw-label-wrap">' +
                    '<input class="sw-label" type="text" value="' + _swEscape(w.label) + '" ' +
                           'placeholder="' + _swEscape(t('sw_label_placeholder')) + '" ' +
                           'onfocus="this.select()" ' +
                           'onchange="swRename(\'' + w.id + '\', this.value)">' +
                    '<svg class="sw-edit-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                '</label>' +
                '<button type="button" class="sw-card-delete" onclick="swDelete(\'' + w.id + '\')" aria-label="' + _swEscape(t('sw_delete')) + '">' +
                    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2"/></svg>' +
                '</button>' +
            '</div>' +
            '<div class="sw-card-row sw-card-row-time">' +
                '<div class="sw-card-time' + idleClass + '" data-sw-time>' + _swFormat(elapsedMs) + '</div>' +
                '<button type="button" class="sw-card-copy" onclick="swCopy(\'' + w.id + '\')" aria-label="' + _swEscape(t('sw_copy')) + '">' +
                    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>' +
                '</button>' +
            '</div>' +
            '<div class="sw-card-actions">' +
                '<button type="button" class="sw-btn sw-btn-primary' + (running ? ' sw-running' : '') + '" onclick="swToggle(\'' + w.id + '\')">' +
                    (running ? _swEscape(t('sw_pause')) : _swEscape(t('sw_start'))) +
                '</button>' +
                '<button type="button" class="sw-btn" onclick="swReset(\'' + w.id + '\')">' + _swEscape(t('sw_reset')) + '</button>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    _swUpdateIndicator(list);
}

function _swTick() {
    var container = document.getElementById('sw-list');
    if (!container) return;
    var list = _swLoad();
    var cards = container.querySelectorAll('.sw-card');
    for (var i = 0; i < cards.length; i++) {
        var id = cards[i].getAttribute('data-id');
        var w = null;
        for (var j = 0; j < list.length; j++) if (list[j].id === id) { w = list[j]; break; }
        if (!w) continue;
        var timeEl = cards[i].querySelector('[data-sw-time]');
        if (timeEl) timeEl.textContent = _swFormat(_swElapsed(w));
    }
}

function _swStartTicker() {
    if (_swTickerId) return;
    _swTickerId = setInterval(_swTick, 1000);
}

function _swStopTicker() {
    if (_swTickerId) { clearInterval(_swTickerId); _swTickerId = null; }
}

var _swAddLastCall = 0;
function swAdd() {
    // Debounce: blokker gjentatte kall innen 500ms (touch + synthetic click, dobbel-tap osv.)
    var now = Date.now();
    if (now - _swAddLastCall < 500) return;
    _swAddLastCall = now;

    var list = _swLoad();
    var newId = _swNewId();
    list.push({
        id: newId,
        label: '',
        startedAt: null,
        accumulatedMs: 0,
        isRunning: false
    });
    _swSave(list);
    _swRenderList();
    // Auto-fokus på den nye label-input slik at brukeren kan skrive ordrenummer direkte
    setTimeout(function() {
        var card = document.querySelector('.sw-card[data-id="' + newId + '"]');
        if (card) {
            var input = card.querySelector('.sw-label');
            if (input) input.focus();
            if (card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 50);
}

function swToggle(id) {
    var list = _swLoad();
    var target = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { target = list[i]; break; }
    if (!target) return;
    if (target.isRunning) {
        // Pause denne
        var delta = Date.now() - (target.startedAt || Date.now());
        if (delta < 0) delta = 0;
        target.accumulatedMs = (target.accumulatedMs || 0) + delta;
        target.isRunning = false;
        target.startedAt = null;
    } else {
        // Auto-pause alle andre løpende
        for (var j = 0; j < list.length; j++) {
            if (list[j].isRunning && list[j].id !== id) {
                var d2 = Date.now() - (list[j].startedAt || Date.now());
                if (d2 < 0) d2 = 0;
                list[j].accumulatedMs = (list[j].accumulatedMs || 0) + d2;
                list[j].isRunning = false;
                list[j].startedAt = null;
            }
        }
        target.startedAt = Date.now();
        target.isRunning = true;
    }
    _swSave(list);
    _swRenderList();
}

function swReset(id) {
    var list = _swLoad();
    var target = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { target = list[i]; break; }
    if (!target) return;
    var doReset = function() {
        var cur = _swLoad();
        for (var j = 0; j < cur.length; j++) {
            if (cur[j].id === id) {
                cur[j].startedAt = null;
                cur[j].accumulatedMs = 0;
                cur[j].isRunning = false;
                cur[j].label = '';
                break;
            }
        }
        _swSave(cur);
        _swRenderList();
        // Fokus på navnefeltet så bruker kan skrive ny bestilling direkte
        setTimeout(function() {
            var card = document.querySelector('.sw-card[data-id="' + id + '"]');
            if (card) {
                var input = card.querySelector('.sw-label');
                if (input) input.focus();
            }
        }, 50);
    };
    // Bekreft kun hvis klokka faktisk har tid på seg eller har navn
    if (_swElapsed(target) > 0 || target.label) {
        var labelPart = target.label ? ' "' + target.label + '"' : '';
        showConfirmModal(t('sw_reset_confirm') + labelPart + '?', doReset, t('sw_reset'), '#E8501A');
    } else {
        doReset();
    }
}

function swRename(id, label) {
    var list = _swLoad();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { list[i].label = String(label || '').slice(0, 60); break; }
    }
    _swSave(list);
}

function swClearAll() {
    var list = _swLoad();
    if (!list.length) return;
    showConfirmModal(
        t('sw_clear_all_confirm').replace('{n}', list.length),
        function() {
            _swSave([]);
            _swRenderList();
        },
        t('btn_remove'),
        '#c43'
    );
}

function swDelete(id) {
    var list = _swLoad();
    var target = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { target = list[i]; break; }
    if (!target) return;
    var doDelete = function() {
        var cur = _swLoad().filter(function(w) { return w.id !== id; });
        _swSave(cur);
        _swRenderList();
    };
    var labelPart = target.label ? ' "' + target.label + '"' : '';
    showConfirmModal(t('sw_delete_confirm') + labelPart + '?', doDelete, t('btn_remove'), '#c43');
}

function swCopy(id) {
    var list = _swLoad();
    var w = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { w = list[i]; break; }
    if (!w) return;
    var text = _swBilledHours(_swElapsed(w));
    function onDone() { showNotificationModal(t('sw_copied_toast') + ' ' + text); }
    function onFail() { showNotificationModal(t('sw_copy_failed')); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onDone, function() {
            _swCopyFallback(text) ? onDone() : onFail();
        });
    } else {
        _swCopyFallback(text) ? onDone() : onFail();
    }
}

function _swCopyFallback(text) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e) { return false; }
}

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
        _swStopTicker();
    } else {
        _swUpdateIndicator();
        var page = document.getElementById('calc-page-stopwatch');
        if (page && page.style.display !== 'none') {
            _swRenderList();
            _swStartTicker();
        }
    }
});
window.addEventListener('pagehide', _swStopTicker);
document.addEventListener('DOMContentLoaded', function() { _swUpdateIndicator(); _kappeInitDatePicker(); });

function calcMulticollar() {
    var input = document.getElementById('calc-mc-diameter');
    var resultEl = document.getElementById('calc-mc-result');
    var val = parseInt(input.value, 10);

    // Clear table highlights
    document.querySelectorAll('#calc-page-multicollar .calc-table-highlight').forEach(function(r) {
        r.classList.remove('calc-table-highlight');
    });

    if (!val || val < 1) {
        resultEl.style.display = 'none';
        return;
    }

    var segments = mcCalcSegments(val);
    var cutLength = segments * MC_SEGMENT_PITCH;

    document.getElementById('calc-mc-seg-value').textContent = segments;
    document.getElementById('calc-mc-cut-length').textContent = cutLength;
    document.getElementById('calc-mc-diameter-echo').textContent = val;
    document.getElementById('calc-mc-clips').innerHTML = mcCalcClips(val);

    // Check if this diameter matches a table row exactly
    var rows = document.querySelectorAll('#calc-page-multicollar .calc-table tbody tr:not(.calc-table-result)');
    var exactMatch = false;
    for (var i = 0; i < rows.length; i++) {
        var rowD = parseInt(rows[i].getAttribute('data-mc-d'), 10);
        if ((i === 0 && val >= 16 && val <= rowD) || (i > 0 && val === rowD)) {
            rows[i].classList.add('calc-table-highlight');
            rows[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            exactMatch = true;
            break;
        }
    }

    // Show calculated result row only for custom diameters not in table
    if (exactMatch) {
        resultEl.style.display = 'none';
    } else {
        resultEl.style.display = 'table-row';
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function onCalcTableRowClick(row) {
    var d = parseInt(row.getAttribute('data-mc-d'), 10);
    if (!d) return;
    var input = document.getElementById('calc-mc-diameter');
    input.value = d;
    calcMulticollar();
    // Scroll to top to see result
    document.querySelector('#calculator-modal .modal-content').scrollTop = 0;
}

// ===== Brannpakning calculator =====

var _bpRowCount = 0;

function bpAddRow(focus) {
    _bpRowCount++;
    var tbody = document.getElementById('bp-rows');
    var tr = document.createElement('tr');
    tr.id = 'bp-row-' + _bpRowCount;
    tr.innerHTML =
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="bp-dim-w" placeholder="—" oninput="bpCalc()"></td>' +
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="bp-dim-h" placeholder="—" oninput="bpCalc()"></td>' +
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" placeholder="—" oninput="bpCalc()"></td>' +
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" placeholder="—" oninput="bpCalc()"></td>' +
        '<td class="bp-result-cell"><span class="bp-result-val">—</span></td>';
    tbody.appendChild(tr);
    tr.querySelector('.bp-result-cell').addEventListener('click', function() {
        var row = this.closest('tr');
        row.classList.toggle('bp-row-disabled');
        bpCalc();
    });
    if (focus) {
        tr.querySelector('input').focus();
    }
}

function bpReset() {
    document.getElementById('bp-rows').innerHTML = '';
    _bpRowCount = 0;
    for (var i = 0; i < 10; i++) bpAddRow(false);
    bpCalc();
}

function bpCalc() {
    var rows = document.querySelectorAll('#bp-rows tr');
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
        var isDisabled = rows[i].classList.contains('bp-row-disabled');
        var allInputs = rows[i].querySelectorAll('input');
        var w = parseLocaleNum(allInputs[0].value) || 0;
        var h = parseLocaleNum(allInputs[1].value) || 0;
        var pipes = parseLocaleNum(allInputs[2].value) || 0;
        var rounds = parseLocaleNum(allInputs[3].value) || 0;

        // Round: π × d, Rectangular: 2 × (B + H)
        var perimeter = h > 0 ? 2 * (w + h) : Math.PI * w;
        var length = perimeter * pipes * rounds / 1000;

        var valSpan = rows[i].querySelector('.bp-result-val');
        if (w > 0 && pipes > 0 && rounds > 0) {
            valSpan.textContent = formatLocaleNum(length, 2);
            valSpan.style.color = '';
            if (!isDisabled) total += length;
        } else {
            valSpan.textContent = '—';
            valSpan.style.color = (w === 0 && h === 0 && pipes === 0 && rounds === 0) ? '#ddd' : '';
        }
    }
    document.getElementById('bp-total-value').textContent = formatLocaleNum(total, 2) + ' m';
}

// ===== Lysåpning Calculator =====

var _laSectionCount = 0;

function laAddSection() {
    _laSectionCount++;
    var container = document.getElementById('la-sections');
    var section = document.createElement('div');
    section.className = 'la-section';
    section.id = 'la-section-' + _laSectionCount;
    var sectionNum = document.getElementById('la-sections').children.length + 1;
    section.innerHTML =
        '<div class="la-section-header"><span>Utsparing ' + sectionNum + '</span><button type="button" class="la-section-remove" onclick="laRemoveSection(this.closest(\'.la-section\'))">✕</button></div>' +
        '<div class="bp-table">' +
            '<table>' +
                '<colgroup><col style="width:15%"><col style="width:35%"><col style="width:35%"><col style="width:15%"></colgroup>' +
                '<thead><tr><th></th><th>Bredde / Ø</th><th>Høyde</th><th></th></tr></thead>' +
                '<tbody>' +
                    '<tr class="la-hole-row"><td class="la-label">Utsp.</td><td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="la-hole-w" placeholder="—" oninput="laCalc()"></td><td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="la-hole-h" placeholder="—" oninput="laCalc()"></td><td class="la-result-cell"><span class="la-result-value">—</span></td></tr>' +
                '</tbody>' +
                '<tbody class="la-pipe-rows"></tbody>' +
            '</table>' +
            '<div class="la-section-actions">' +
                '<button type="button" class="bp-add-btn" onclick="laAddPipe(this.closest(\'.la-section\'))">+ Rør</button>' +
                '<button type="button" class="bp-add-btn calc-reset-btn" onclick="laResetSection(this.closest(\'.la-section\'))">Nullstill</button>' +
            '</div>' +
        '</div>';
    container.appendChild(section);
    // Add 1 pipe row
    laAddPipe(section, false);
    return section;
}

function laAddPipe(sectionEl, focus) {
    if (focus === undefined) focus = true;
    var tbody = sectionEl.querySelector('.la-pipe-rows');
    var pipeCount = tbody.children.length + 1;
    var tr = document.createElement('tr');
    tr.innerHTML =
        '<td class="la-label">Rør ' + pipeCount + '</td>' +
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="la-pipe-w" placeholder="—" oninput="laCalc()"></td>' +
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="la-pipe-h" placeholder="—" oninput="laCalc()"></td>' +
        '<td class="la-pipe-remove-cell"><button type="button" class="la-pipe-remove" onclick="laRemovePipe(this)">✕</button></td>';
    tbody.appendChild(tr);
    if (focus) {
        tr.querySelector('.la-pipe-w').focus();
    }
}

function laRemovePipe(btn) {
    var tr = btn.closest('tr');
    var section = tr.closest('.la-section');
    var tbody = section.querySelector('.la-pipe-rows');
    if (tbody.children.length <= 1) return;
    tr.remove();
    // Renumber pipes
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
        rows[i].querySelector('.la-label').textContent = 'Rør ' + (i + 1);
    }
    laCalc();
}

function laRemoveSection(sectionEl) {
    var container = document.getElementById('la-sections');
    if (container.children.length <= 1) return;
    sectionEl.remove();
    laRenumberSections();
    laCalc();
}

function laRenumberSections() {
    var sections = document.querySelectorAll('.la-section');
    for (var i = 0; i < sections.length; i++) {
        sections[i].querySelector('.la-section-header > span').textContent = 'Utsparing ' + (i + 1);
    }
}

function laResetSection(sectionEl) {
    sectionEl.querySelector('.la-hole-w').value = '';
    sectionEl.querySelector('.la-hole-h').value = '';
    var tbody = sectionEl.querySelector('.la-pipe-rows');
    tbody.innerHTML = '';
    laAddPipe(sectionEl, false);
    laCalc();
}

function laCalc() {
    var sections = document.querySelectorAll('.la-section');
    for (var s = 0; s < sections.length; s++) {
        var holeW = parseLocaleNum(sections[s].querySelector('.la-hole-w').value) || 0;
        var holeH = parseLocaleNum(sections[s].querySelector('.la-hole-h').value) || 0;
        var holeSize = holeH > 0 ? Math.min(holeW, holeH) : holeW;

        var rows = sections[s].querySelectorAll('.la-pipe-rows tr');
        var totalPipeSize = 0;
        var hasPipes = false;

        for (var i = 0; i < rows.length; i++) {
            var pipeW = parseLocaleNum(rows[i].querySelector('.la-pipe-w').value) || 0;
            var pipeH = parseLocaleNum(rows[i].querySelector('.la-pipe-h').value) || 0;
            if (pipeW > 0) {
                totalPipeSize += pipeH > 0 ? Math.max(pipeW, pipeH) : pipeW;
                hasPipes = true;
            }
        }

        var resultEl = sections[s].querySelector('.la-result-value');
        if (holeSize > 0 && hasPipes) {
            var la = (holeSize - totalPipeSize) / 2;
            resultEl.textContent = formatLocaleNum(la, 1);
            resultEl.style.color = la < 0 ? '#d32f2f' : '';
        } else {
            resultEl.textContent = '—';
            resultEl.style.color = '#ddd';
        }
    }
}

// ===== Brannplate Calculator =====

var _bplRowCount = 0;

function bplAddRow(focus) {
    _bplRowCount++;
    var tbody = document.getElementById('bpl-rows');
    var tr = document.createElement('tr');
    tr.id = 'bpl-row-' + _bplRowCount;
    tr.innerHTML =
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="bpl-w" placeholder="—" oninput="bplCalc()"></td>' +
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="bpl-h" placeholder="—" oninput="bplCalc()"></td>' +
        '<td><input type="text" inputmode="decimal" pattern="[0-9,.]*" class="bpl-qty" placeholder="—" oninput="bplCalc()"></td>' +
        '<td class="bp-result-cell"><span class="bp-result-val">—</span></td>';
    tbody.appendChild(tr);
    tr.querySelector('.bp-result-cell').addEventListener('click', function() {
        var row = this.closest('tr');
        row.classList.toggle('bp-row-disabled');
        bplCalc();
    });
    if (focus) {
        tr.querySelector('input').focus();
    }
}

function bplReset() {
    var defaults = JSON.parse(localStorage.getItem('firesafe_plate_size') || '{"w":1200,"h":600}');
    document.getElementById('bpl-plate-w').value = defaults.w;
    document.getElementById('bpl-plate-h').value = defaults.h;
    document.getElementById('bpl-rows').innerHTML = '';
    _bplRowCount = 0;
    for (var i = 0; i < 10; i++) bplAddRow(false);
    bplCalc();
}

function bplSetDefault() {
    var w = parseLocaleNum(document.getElementById('bpl-plate-w').value) || 1200;
    var h = parseLocaleNum(document.getElementById('bpl-plate-h').value) || 600;
    var data = { w: w, h: h };
    localStorage.setItem('firesafe_plate_size', JSON.stringify(data));
    enqueueUserDocSet('settings', 'plateSize', data, 'Save plate size');
    showNotificationModal('Standard platestørrelse lagret: ' + formatLocaleNum(w) + ' × ' + formatLocaleNum(h) + ' mm', true);
}

function bplCalc() {
    var rows = document.querySelectorAll('#bpl-rows tr');
    var totalPlates = 0;

    for (var i = 0; i < rows.length; i++) {
        var isDisabled = rows[i].classList.contains('bp-row-disabled');
        var w = parseLocaleNum(rows[i].querySelector('.bpl-w').value) || 0;
        var h = parseLocaleNum(rows[i].querySelector('.bpl-h').value) || 0;
        var qty = parseLocaleNum(rows[i].querySelector('.bpl-qty').value) || 0;

        var plateW = parseLocaleNum(document.getElementById('bpl-plate-w').value) || 0;
        var plateH = parseLocaleNum(document.getElementById('bpl-plate-h').value) || 0;
        var plateArea = plateW * plateH;

        var area = w * h * qty;
        var valSpan = rows[i].querySelector('.bp-result-val');
        if (w > 0 && h > 0 && qty > 0 && plateArea > 0) {
            var plates = area / plateArea;
            valSpan.textContent = formatLocaleNum(plates, 2);
            valSpan.style.color = '';
            if (!isDisabled) totalPlates += plates;
        } else {
            valSpan.textContent = '—';
            valSpan.style.color = (w === 0 && h === 0 && qty === 0) ? '#ddd' : '';
        }
    }

    document.getElementById('bpl-plate-count').textContent = totalPlates > 0 ? formatLocaleNum(totalPlates, 2) : '0';
}

// ===== Bil (Vehicle Inventory) =====

async function syncBilHistory() {
    if (!currentUser || !db) return;
    try {
        // Sync bil påfyllinger (inntak)
        var bilSnap = await db.collection('users').doc(currentUser.uid)
            .collection('bilPafylling').orderBy('createdAt', 'desc').limit(50).get();
        if (!bilSnap.empty) {
            var bilData = bilSnap.docs.map(function(doc) { return doc.data(); });
            safeSetItem(BIL_STORAGE_KEY, JSON.stringify(bilData));
        }
        // Sync service forms (lagrede + sendte lageruttak)
        var serviceResults = await Promise.all([getServiceForms(), getServiceSentForms()]);
        if (serviceResults[0].forms && serviceResults[0].forms.length > 0) {
            safeSetItem(SERVICE_STORAGE_KEY, JSON.stringify(serviceResults[0].forms.slice(0, 50)));
        }
        if (serviceResults[1].forms && serviceResults[1].forms.length > 0) {
            safeSetItem(SERVICE_ARCHIVE_KEY, JSON.stringify(serviceResults[1].forms.slice(0, 50)));
        }
        // Sync ordresedler (lagrede + sendte)
        var formResults = await Promise.all([getSavedForms(), getSentForms()]);
        if (formResults[0].forms && formResults[0].forms.length > 0) {
            safeSetItem(STORAGE_KEY, JSON.stringify(formResults[0].forms.slice(0, 50)));
        }
        if (formResults[1].forms && formResults[1].forms.length > 0) {
            safeSetItem(ARCHIVE_KEY, JSON.stringify(formResults[1].forms.slice(0, 50)));
        }
        // Re-render if on home page
        if (document.body.classList.contains('template-modal-open')) {
            _bilHistoryRendered = false;
            renderBilHistory();
            _bilHistoryRendered = true;
        }
    } catch (e) { console.error('Sync bil history error:', e); }
}

function renderBilHistory() {
    var listEl = document.getElementById('bil-history-list');
    var items = [];

    // Påfyllinger
    var pafyllinger = safeParseJSON(BIL_STORAGE_KEY, []);
    for (var i = 0; i < pafyllinger.length; i++) {
        var p = pafyllinger[i];
        items.push({
            type: 'pafylling',
            id: p.id,
            dato: p.dato || '',
            createdAt: p.createdAt || '',
            materials: p.materials || []
        });
    }

    // Uttak — både lagrede (drafts) og sendte service-skjemaer.
    // window.loadedServiceForms er kilden for select-mode bulk-eksport. Sett den lik
    // alle uttak-skjemaer (saved + sent dedupet) slik at toggleFormSelection /
    // _getSelectedForms kan slå opp skjema via samme indeks som data-form-idx.
    var saved = safeParseJSON(SERVICE_STORAGE_KEY, []);
    var archived = safeParseJSON(SERVICE_ARCHIVE_KEY, []);
    var combined = [];
    var seen = {};
    for (var ai = 0; ai < archived.length; ai++) {
        var sf = archived[ai];
        if (sf && sf.id) seen[sf.id] = true;
        combined.push(Object.assign({}, sf, { _isSent: true }));
    }
    for (var si = 0; si < saved.length; si++) {
        var df = saved[si];
        if (df && df.id && seen[df.id]) continue; // arkiv-versjon vinner ved duplikat
        combined.push(Object.assign({}, df, { _isSent: false }));
    }
    window.loadedServiceForms = combined;
    for (var i2 = 0; i2 < combined.length; i2++) {
        var form = combined[i2];
        var entries = form.entries || [];
        for (var j = 0; j < entries.length; j++) {
            var entry = entries[j];
            if (!entry.materials || entry.materials.length === 0) continue;
            items.push({
                type: 'uttak',
                formIdx: i2, // indeks i window.loadedServiceForms — brukes for select-mode + open
                isSent: !!form._isSent,
                dato: entry.dato || '',
                createdAt: form.savedAt || '',
                prosjektnr: entry.prosjektnr || '',
                prosjektnavn: entry.prosjektnavn || '',
                materials: entry.materials
            });
        }
    }

    // Sort by createdAt descending
    items.sort(function(a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    if (items.length === 0) {
        listEl.innerHTML = '<div class="bil-empty-msg">' + t('bil_no_history') + '</div>';
        if (_selectMode && _selectTab === 'service') updateSelectionUI();
        return;
    }

    var html = '';
    for (var i3 = 0; i3 < items.length; i3++) {
        var item = items[i3];
        var isPafylling = item.type === 'pafylling';
        var typeLabel = isPafylling ? t('bil_history_pafylling') : t('bil_history_uttak');
        // Status-dot: inntak er alltid "ferdig" (grønn). Uttak: oransje for lagret/draft, grønn for sendt.
        var dotClass = isPafylling ? 'sent' : (item.isSent ? 'sent' : 'saved');
        var statusDot = '<span class="status-dot ' + dotClass + '"></span>';
        var titleHtml = escapeHtml(item.dato);
        var subtitleHtml = '';
        if (isPafylling) {
            // Inntak har ingen prosjekt-info — vis bare "Servicebil" så subtitle-rad
            // er konsistent med uttak-kortene som viser prosjektnr/prosjektnavn.
            subtitleHtml = t('servicebil_title');
        } else {
            var subParts = [];
            if (item.prosjektnr) subParts.push(escapeHtml(item.prosjektnr));
            if (item.prosjektnavn) subParts.push(escapeHtml(item.prosjektnavn));
            if (subParts.length) subtitleHtml = subParts.join('<span class="bil-history-sep"></span>');
        }

        var matsHtml = '';
        // Helper to build detail parts for a material
        function buildBilDetail(m) {
            var detailParts = [];
            var pipeInfo = getRunningMeterInfo(m.name);
            var pipes = parseFloat((m.antall || '').replace(',', '.'));
            if (pipeInfo && !isNaN(pipes) && pipes > 0) {
                var lm = calculateRunningMeters(pipeInfo, pipes);
                detailParts.push(formatRunningMeters(lm) + ' meter');
            } else {
                var bilQuantityUnit = m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source);
                var bilUnit = bilQuantityUnit === 'meter' ? ' meter' : ' ' + bilQuantityUnit;
                detailParts.push(formatRunningMeters(m.antall) + bilUnit);
            }
            return detailParts.join(' ');
        }
        // Helper to inject "(N stk × M lag)" into a formatted name for pipe-spec entries
        function injectBilStkLag(formattedName, m) {
            var pipeInfo = getRunningMeterInfo(m.name);
            var pipes = parseFloat((m.antall || '').replace(',', '.'));
            if (!pipeInfo || isNaN(pipes) || pipes <= 0) return formatDisplayForBreak(formattedName);
            var lagMatch = formattedName.match(/^(.+?) \((\d+) lag\)$/);
            var baseSpec = lagMatch ? lagMatch[1] : formattedName;
            var rounds = lagMatch ? parseInt(lagMatch[2], 10) : 1;
            var result = rounds > 1
                ? baseSpec + ' (' + (m.antall || '0') + ' stk \u00d7 ' + rounds + ' lag)'
                : baseSpec + ' (' + (m.antall || '0') + ' stk)';
            return formatDisplayForBreak(result);
        }
        // Helper to format a full material name (with variant appended)
        function formatBilName(m) {
            var bilName = (m.name || '');
            bilName = bilName.charAt(0).toUpperCase() + bilName.slice(1);
            bilName = formatKabelhylseSpec(bilName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
            var bilEnhet = normalizeVariant(m.name, m.enhet || '').toLowerCase();
            if (bilEnhet && bilEnhet !== 'stk' && bilEnhet !== 'meter') {
                bilName += ' ' + bilEnhet;
            }
            return injectBilStkLag(bilName, m);
        }
        var bilGroups = groupMaterialsByBase(item.materials);
        for (var g = 0; g < bilGroups.length; g++) {
            var bilGroup = bilGroups[g];
            if (!bilGroup.isSpecGroup && !bilGroup.isIsolationGroup && !bilGroup.isStiftGroup) {
                for (var fi = 0; fi < bilGroup.items.length; fi++) {
                    var m = bilGroup.items[fi];
                    matsHtml += '<div class="bil-history-mat"><div class="mat-summary-row">'
                        + '<span class="mat-summary-name">' + escapeHtml(formatBilName(m)) + '</span>'
                        + '<span class="mat-summary-detail">' + buildBilDetail(m) + '</span>'
                        + '</div></div>';
                }
            } else {
                var bilGroupTitle = bilGroup.displayName || bilGroup.baseName;
                matsHtml += '<div class="bil-history-mat"><div class="bil-history-group-header">'
                    + escapeHtml(bilGroupTitle.charAt(0).toUpperCase() + bilGroupTitle.slice(1))
                    + '</div>';
                for (var gi = 0; gi < bilGroup.items.length; gi++) {
                    var gm = bilGroup.items[gi];
                    var subName = getGroupedDisplayName(gm, bilGroup.baseName);
                    subName = subName.charAt(0).toUpperCase() + subName.slice(1);
                    subName = formatKabelhylseSpec(subName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
                    subName = injectBilStkLag(subName, gm);
                    matsHtml += '<div class="bil-history-grouped"><div class="mat-summary-row">'
                        + '<span class="mat-summary-name">' + escapeHtml(subName) + '</span>'
                        + '<span class="mat-summary-detail">' + buildBilDetail(gm) + '</span>'
                        + '</div></div>';
                }
                matsHtml += '</div>';
            }
        }

        var deleteBtn = isPafylling
            ? '<button class="bil-history-delete" onclick="deleteBilPafylling(\'' + item.id + '\')" title="Slett">' + deleteIcon + '</button>'
            : '';

        var hiddenClass = i3 >= 10 ? ' bil-history-hidden' : '';
        // Uttak-kort får data-form-idx slik at de kan velges i bulk-modus
        var dataAttr = isPafylling ? '' : ' data-form-idx="' + item.formIdx + '"';
        // Marker som .selected hvis denne form-idx allerede er i selectedSet (re-render etter delete o.l.)
        var selectedClass = (!isPafylling && _selectMode && _selectTab === 'service' && _selectedSet.has(item.formIdx))
            ? ' selected' : '';
        html += '<div class="bil-history-card ' + (isPafylling ? 'bil-card-pafylling' : 'bil-card-uttak') + hiddenClass + selectedClass + '"' + dataAttr + '>' +
            '<div class="bil-history-header">' +
                statusDot +
                '<span class="bil-history-type">' + escapeHtml(typeLabel) + '</span>' +
                '<span class="bil-history-title">' + titleHtml + '</span>' +
                deleteBtn +
            '</div>' +
            (subtitleHtml ? '<div class="bil-history-subtitle">' + subtitleHtml + '</div>' : '') +
            '<div class="bil-history-materials">' + matsHtml + '</div>' +
        '</div>';
    }

    if (items.length > 10) {
        var remaining = items.length - 10;
        html += '<button type="button" class="bil-history-toggle" id="bil-history-more" onclick="toggleBilHistory()">' + t('bil_show_more', remaining) + '</button>';
    }

    listEl.innerHTML = html;
    if (_selectMode && _selectTab === 'service') updateSelectionUI();
}

// Event delegation for bil-history-list:
//  - Select-mode: tap på uttak-kort toggler valg (inntak/påfylling kan ikke velges).
//  - Normal-mode: tap på uttak-kort åpner skjemaet (loadServiceFormDirect).
//  - Inntak/pafylling-kort har bare delete-knapp (håndtert via inline onclick).
(function() {
    var bilListEl = document.getElementById('bil-history-list');
    if (!bilListEl) return;
    bilListEl.addEventListener('click', function(e) {
        // Ikke tolk delete-klikk som åpning/valg
        if (e.target.closest('.bil-history-delete')) return;
        var card = e.target.closest('.bil-card-uttak[data-form-idx]');
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-form-idx'), 10);
        if (isNaN(idx)) return;
        e.preventDefault();
        e.stopPropagation();
        if (_selectMode && _selectTab === 'service') {
            toggleFormSelection(idx, card);
            return;
        }
        // Normal-mode: åpne skjemaet for redigering / re-eksport
        var form = (window.loadedServiceForms || [])[idx];
        if (form && typeof loadServiceFormDirect === 'function') {
            loadServiceFormDirect(form);
        }
    });
})();

function toggleBilHistory() {
    var hidden = document.querySelectorAll('.bil-history-hidden');
    var btn = document.getElementById('bil-history-more');
    var isExpanded = hidden.length > 0 && !hidden[0].classList.contains('bil-history-hidden-active');
    for (var i = 0; i < hidden.length; i++) {
        hidden[i].classList.toggle('bil-history-hidden-active', isExpanded);
    }
    if (btn) {
        btn.textContent = isExpanded ? t('bil_show_less') : t('bil_show_more', hidden.length);
    }
}

function saveBilPafylling(materials) {
    var record = {
        id: Date.now().toString(),
        dato: formatDate(new Date()),
        materials: materials,
        createdAt: new Date().toISOString()
    };
    var list = safeParseJSON(BIL_STORAGE_KEY, []);
    list.unshift(record);
    safeSetItem(BIL_STORAGE_KEY, JSON.stringify(list));

    enqueueUserDocSet('bilPafylling', record.id, record, 'Bil påfylling Firebase');

    renderBilHistory();
    showNotificationModal(t('bil_pafylling_saved'), true);
}

function deleteBilPafylling(id) {
    showConfirmModal(t('bil_delete_pafylling_confirm'), function() {
        var list = safeParseJSON(BIL_STORAGE_KEY, []);
        var idx = list.findIndex(function(item) { return item.id === id; });
        if (idx !== -1) {
            list.splice(idx, 1);
            safeSetItem(BIL_STORAGE_KEY, JSON.stringify(list));
        }

        enqueueUserDocDelete('bilPafylling', id, 'Delete bil påfylling Firebase');

        renderBilHistory();
    }, t('btn_delete'), '#d32f2f');
}

// ===== Template Picker (in-form) =====

function openTemplatePicker() {
    var overlay = document.getElementById('template-picker-overlay');
    var listEl = document.getElementById('template-picker-list');
    var searchEl = document.getElementById('template-picker-search');
    searchEl.value = '';

    // Load cached templates
    var cached = safeParseJSON(TEMPLATE_KEY, []).filter(function(t) { return t.active !== false; });
    _renderTemplatePickerList(cached, listEl);

    overlay.classList.add('active');
    requestAnimationFrame(function() { overlay.classList.add('visible'); });

    // Refresh from Firestore
    if (currentUser && db) {
        getTemplates().then(function(result) {
            _templateLastDoc = result.lastDoc;
            _templateHasMore = result.hasMore;
            safeSetItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
            var active = result.forms.filter(function(t) { return t.active !== false; });
            if (overlay.classList.contains('active')) {
                _renderTemplatePickerList(active, listEl);
            }
        }).catch(function(e) { console.error('Template picker refresh:', e); });
    }
}

function closeTemplatePicker() {
    var overlay = document.getElementById('template-picker-overlay');
    overlay.classList.remove('visible');
    setTimeout(function() {
        overlay.classList.remove('active');
    }, 150);
    _kappeTemplateActive = false;
}

function _renderTemplatePickerList(templates, listEl) {
    if (!templates || templates.length === 0) {
        listEl.innerHTML = '<div class="bil-empty-msg">' + t('no_templates') + '</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < templates.length; i++) {
        html += _buildTemplateItemHtml(templates[i], i);
    }
    listEl.innerHTML = html;

    // Attach click handlers
    var items = listEl.querySelectorAll('.saved-item');
    for (var j = 0; j < items.length; j++) {
        items[j]._formData = templates[j];
    }
}

var _serviceTemplateTargetCard = null;

var _kappeTemplateActive = false;

function openKappeTemplatePicker() {
    _kappeTemplateActive = true;
    _serviceTemplateTargetCard = null;
    openTemplatePicker();
}

function openServiceTemplatePicker(btn) {
    _kappeTemplateActive = false;
    // Find the first expanded entry card, or the first one
    var cards = document.querySelectorAll('#service-entries .service-entry-card');
    _serviceTemplateTargetCard = null;
    for (var i = 0; i < cards.length; i++) {
        var body = cards[i].querySelector('.service-entry-body');
        if (body && body.style.display !== 'none') {
            _serviceTemplateTargetCard = cards[i];
            break;
        }
    }
    if (!_serviceTemplateTargetCard && cards.length > 0) {
        _serviceTemplateTargetCard = cards[0];
    }
    openTemplatePicker();
}

function _applyTemplateToForm(template) {
    if (!template) return;

    if (_kappeTemplateActive) {
        // Apply to kappe form — kun prosjekt-info (leveringsadresse fylles manuelt)
        if (template.prosjektnr) document.getElementById('kappe-prosjektnr').value = template.prosjektnr;
        if (template.prosjektnavn) document.getElementById('kappe-prosjektnavn').value = template.prosjektnavn;
        renumberKappeLines();
        _kappeTemplateActive = false;
    } else if (_serviceTemplateTargetCard) {
        // Apply to service entry card
        var card = _serviceTemplateTargetCard;
        var pnr = card.querySelector('.service-entry-prosjektnr');
        var pnavn = card.querySelector('.service-entry-prosjektnavn');
        if (pnr && template.prosjektnr) pnr.value = template.prosjektnr;
        if (pnavn && template.prosjektnavn) pnavn.value = template.prosjektnavn;
        _serviceTemplateTargetCard = null;
        renumberServiceEntries();
    } else {
        // Apply to ordreseddel form
        var fields = {
            'oppdragsgiver': template.oppdragsgiver,
            'prosjektnr': template.prosjektnr,
            'prosjektnavn': template.prosjektnavn,
            'kundens-ref': template.kundensRef,
            'fakturaadresse': template.fakturaadresse
        };
        for (var id in fields) {
            var val = fields[id];
            if (val) {
                var el = document.getElementById(id);
                var mobileEl = document.getElementById('mobile-' + id);
                if (el) el.value = val;
                if (mobileEl) mobileEl.value = val;
            }
        }
        updateFakturaadresseDisplay('fakturaadresse-display-text', template.fakturaadresse || '');
    }
    closeTemplatePicker();
}

// ============================================================================
// KAPPESKJEMA
// ============================================================================

var _kappeCurrentId = null;
var _kappeLastSavedData = null;

function _kappeTodayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var da = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + da;
}

function _kappeFormatDateNO(isoOrDMY) {
    if (!isoOrDMY) return '';
    var s = String(isoOrDMY);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '.' + m[2] + '.' + m[1];
    return s;
}

function _kappeParseDateNO(dmyStr) {
    if (!dmyStr) return '';
    var m = String(dmyStr).match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return '';
}

function _kappeInitDatePicker() {
    var textEl = document.getElementById('kappe-onsket-leveringsdato');
    if (!textEl) return;
    textEl.addEventListener('blur', function() {
        var iso = _kappeParseDateNO(textEl.value);
        if (iso) {
            textEl.value = _kappeFormatDateNO(iso);
        }
    });
}

function toggleKappeDeliverySection(headerEl) {
    if (document.activeElement) document.activeElement.blur();
    var card = headerEl.closest('.mobile-order-card');
    if (!card) return;
    var wrap = card.querySelector('.mobile-order-body-wrap');
    var arrow = headerEl.querySelector('.mobile-order-arrow');
    if (!wrap.classList.contains('expanded')) {
        wrap.classList.add('expanded');
        if (arrow) arrow.innerHTML = '&#9650;';
        requestAnimationFrame(function() { scrollCardToTop(card, true); });
    } else {
        wrap.classList.remove('expanded');
        if (arrow) arrow.innerHTML = '&#9660;';
    }
}

function _kappeApplyDeliveryCollapsedState(forceCollapse) {
    var card = document.getElementById('kappe-delivery-card');
    if (!card) return;
    var wrap = card.querySelector('.mobile-order-body-wrap');
    var arrow = card.querySelector('.mobile-order-arrow');
    if (forceCollapse) {
        if (wrap) wrap.classList.remove('expanded');
        if (arrow) arrow.innerHTML = '&#9660;';
    }
}

function _setKappeDatoToday() {
    var el = document.getElementById('kappe-dato');
    if (el) el.value = _kappeFormatDateNO(_kappeTodayISO());
}

function openNewKappeForm() {
    document.body.classList.remove('template-modal-open');

    var defaults = getMinInfo();
    _kappeCurrentId = null;

    function _kappeAutofill(field) {
        return (defaults['autofill_' + field] !== false) ? (defaults[field] || '') : '';
    }

    document.getElementById('kappe-dato').value = _kappeFormatDateNO(_kappeTodayISO());
    document.getElementById('kappe-onsket-leveringsdato').value = '';
    document.getElementById('kappe-avdeling').value = _kappeAutofill('avdeling');
    document.getElementById('kappe-bestiller').value = _kappeAutofill('montor');
    document.getElementById('kappe-prosjektnr').value = '';
    document.getElementById('kappe-prosjektnavn').value = '';
    document.getElementById('kappe-mottaker').value = '';
    document.getElementById('kappe-veiadresse').value = '';
    document.getElementById('kappe-postnr').value = '';
    document.getElementById('kappe-poststed').value = '';
    document.getElementById('kappe-kontakt').value = '';
    document.getElementById('kappe-tlf').value = '';
    document.getElementById('kappe-pallemerking').value = '';
    _kappeApplyDeliveryCollapsedState(true);

    var linesContainer = document.getElementById('kappe-lines');
    linesContainer.innerHTML = '';
    linesContainer.appendChild(createKappeLineCard({}, true));
    renumberKappeLines();
    updateKappeDeleteStates();
    renderKappeStiftRows();
    updateKappeRequiredIndicators();

    document.getElementById('kappe-sent-banner').style.display = 'none';
    document.getElementById('btn-kappe-sent').style.display = '';
    document.getElementById('kappe-save-btn').disabled = false;
    sessionStorage.removeItem('firesafe_kappe_sent');
    _kappeLastSavedData = getKappeFormDataSnapshot();
    sessionStorage.setItem('firesafe_kappe_current', _kappeLastSavedData);

    showView('kappe-view');
    document.body.classList.add('kappe-view-open');
    window.location.hash = 'kappe';

    requestAnimationFrame(function() {
        document.getElementById('kappe-view').scrollTop = 0;
        window.scrollTo(0, 0);
    });
}

function closeKappeView() {
    document.body.classList.remove('kappe-view-open');
    _kappeCurrentId = null;
    _kappeLastSavedData = null;
    sessionStorage.removeItem('firesafe_kappe_current');
    sessionStorage.removeItem('firesafe_kappe_sent');
}

function _formatDimMm(d) {
    if (!d) return '';
    return /mm$/i.test(d) ? d : d + 'mm';
}

function _kappeProductPickerHtml(selectedName, plateLen, plateWid) {
    var displayText = selectedName || t('kappe_product_placeholder');
    var placeholderClass = selectedName ? '' : ' kappe-line-product-text-placeholder';
    var plateHint = '';
    if (selectedName && plateLen && plateWid) {
        plateHint = '<span class="kappe-line-product-plate-hint">' + escapeHtml(plateLen + '×' + plateWid) + '</span>';
    }
    return '<button type="button" class="kappe-line-product-btn" onclick="openKappeProductPicker(this)">' +
        '<span class="kappe-line-product-info">' +
            '<span class="kappe-line-product-text' + placeholderClass + '">' + escapeHtml(displayText) + '</span>' +
            plateHint +
        '</span>' +
        '<span class="kappe-line-product-arrow">▾</span>' +
    '</button>' +
    '<input type="hidden" class="kappe-line-product" value="' + escapeHtml(selectedName || '') + '">';
}

// Returnerer global default plate-størrelse fra innstillinger.
function _getDefaultPlate() {
    var gp = (typeof getKappePlate === 'function') ? getKappePlate() : { lengde: 1200, bredde: 1000 };
    return { lengde: String(gp.lengde), bredde: String(gp.bredde) };
}

var _currentKappeProductBtn = null;
var _productDimensionPickerCallback = null;
var _productDimensionPickerProducts = [];
var _productDimensionPickerDimensions = [];
var _productDimensionPickerGetDimensionsForProduct = null;
var _productDimensionPickerShowPlate = true;
var _productDimensionPickerShowBredde = false;
var _productDimensionPickerRequireDimension = false;
var _productDimensionPickerMultiDim = false;
var _productDimensionPickerOnConfirmMulti = null;
var _productDimensionPickerOnClear = null;
var _kappePickerSelectedBrand = null;
var _kappePickerSelectedDim = null;
// Multi-modus: valgte {name, dim}-par på tvers av produkter (festemiddel).
var _kappePickerSelectedPairs = [];
// 'bredde'|'plate' for isolasjon, 'stk'|'eske' for festemiddel.
// Aktiv toggle bestemmes av produkttype i _updateKappePickerBreddeVisibility.
var _kappePickerSpecMode = 'bredde';
var ISO_MODES = ['bredde', 'plate'];
var FASTENER_MODES = ['stk', 'eske'];

function _escapeKappePickerJs(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _normalizeProductDimensionPickerDim(value, dimensions) {
    if (!value) return null;
    var raw = String(value).trim();
    var wanted = _formatDimMm(raw).toLowerCase();
    for (var i = 0; i < dimensions.length; i++) {
        var dim = String(dimensions[i] || '').trim();
        if (!dim) continue;
        if (dim.toLowerCase() === raw.toLowerCase()) return dim;
        if (_formatDimMm(dim).toLowerCase() === wanted) return dim;
    }
    return null;
}

function _parseProductDimensionValue(value, products) {
    var currentValue = String(value || '').trim();
    var result = { brand: '', dim: '' };
    if (!currentValue) return result;
    for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (!p || !p.name) continue;
        if (currentValue === p.name) {
            result.brand = p.name;
            return result;
        }
        if (currentValue.indexOf(p.name + ' ') === 0) {
            result.brand = p.name;
            result.dim = currentValue.substring(p.name.length + 1).trim();
            return result;
        }
    }
    return result;
}

function openProductDimensionPicker(options) {
    options = options || {};
    var overlay = document.getElementById('kappe-product-picker-overlay');
    if (!overlay) return false;

    var products = (options.products || getKappeProducts()).filter(function(product) {
        return product && product.name;
    });
    var dimensions = (options.dimensions || getKappeDimensions()).map(function(dim) {
        return String(dim || '').trim();
    }).filter(function(dim) {
        return !!dim;
    });
    _sortKappeNumeric(dimensions);

    if (!products.length) {
        showNotificationModal(t('kappe_settings_no_products'));
        return false;
    }
    if (options.requireDimension && !dimensions.length) {
        showNotificationModal(t('kappe_settings_no_dimensions'));
        return false;
    }

    _productDimensionPickerCallback = options.onConfirm || null;
    _productDimensionPickerProducts = products;
    _productDimensionPickerDimensions = dimensions;
    _productDimensionPickerGetDimensionsForProduct = typeof options.getDimensionsForProduct === 'function'
        ? options.getDimensionsForProduct
        : null;
    _productDimensionPickerShowPlate = !!options.showPlate;
    _productDimensionPickerShowBredde = !!options.showBredde;
    _productDimensionPickerRequireDimension = !!options.requireDimension;
    _productDimensionPickerMultiDim = !!options.multiDimension;
    _productDimensionPickerOnConfirmMulti = typeof options.onConfirmMulti === 'function' ? options.onConfirmMulti : null;
    _productDimensionPickerOnClear = typeof options.onClear === 'function' ? options.onClear : null;
    _kappePickerSelectedPairs = (_productDimensionPickerMultiDim && options.initialPairs)
        ? options.initialPairs.map(function(p) { return { name: p.name, dim: p.dim }; })
        : [];

    var clearBtn = document.getElementById('kappe-picker-clear-btn');
    if (clearBtn) clearBtn.style.display = _productDimensionPickerOnClear ? '' : 'none';

    var titleEl = document.getElementById('product-dimension-picker-title');
    if (titleEl) titleEl.textContent = options.title || t('kappe_col_produkt');

    var plateSection = document.getElementById('product-dimension-picker-plate-section');
    if (plateSection) plateSection.style.display = _productDimensionPickerShowPlate ? '' : 'none';

    var plateLenInput = document.getElementById('kappe-picker-plate-length');
    var plateWidInput = document.getElementById('kappe-picker-plate-width');
    if (_productDimensionPickerShowPlate && plateLenInput && plateWidInput) {
        var def = _getDefaultPlate();
        plateLenInput.value = (options.plate && options.plate.length) || def.lengde;
        plateWidInput.value = (options.plate && options.plate.width) || def.bredde;
    }

    // Spec-toggle: isolasjon → 'bredde'/'plate', festemiddel → 'stk'/'eske'.
    // initialMode kan være en av disse fire — defaultes basert på selected product type.
    var im = options.initialMode || '';
    var initialIsFastener = options.initialFastener || (FASTENER_MODES.indexOf(im) !== -1);
    if (FASTENER_MODES.indexOf(im) !== -1) _kappePickerSpecMode = im;
    else if (ISO_MODES.indexOf(im) !== -1) _kappePickerSpecMode = im;
    else _kappePickerSpecMode = initialIsFastener ? 'stk' : 'bredde';
    var breddeInput = document.getElementById('kappe-picker-bredde-input');
    if (breddeInput) {
        breddeInput.value = options.initialBredde
            ? String(options.initialBredde).replace(/mm$/i, '')
            : '';
    }
    // Plate-input (synlig i begge isolasjons-moduser): pre-fyll fra prefill, eller produktets
    // tildelte plate (via register), eller global default som siste fallback.
    var plateLenSpec = document.getElementById('kappe-picker-spec-plate-length');
    var plateWidSpec = document.getElementById('kappe-picker-spec-plate-width');
    if (plateLenSpec && plateWidSpec) {
        if (options.initialPlate && (options.initialPlate.length || options.initialPlate.width)) {
            plateLenSpec.value = options.initialPlate.length || '';
            plateWidSpec.value = options.initialPlate.width || '';
        } else if (typeof getKappePlateForProduct === 'function' && _kappePickerSelectedBrand) {
            var assignedDefault = getKappePlateForProduct(_kappePickerSelectedBrand);
            plateLenSpec.value = assignedDefault.length;
            plateWidSpec.value = assignedDefault.width;
        } else {
            var def = _getDefaultPlate();
            plateLenSpec.value = def.lengde;
            plateWidSpec.value = def.bredde;
        }
    }

    // Prefyll LM/Antall/Sider for isolasjon bredde-modus. Defaults: antall=1, sider=1, lm tom.
    var usage = options.initialUsage || {};
    var lmPerSideEl = document.getElementById('kappe-picker-lm-per-side');
    var antallObjEl = document.getElementById('kappe-picker-antall-objekter');
    var siderEl = document.getElementById('kappe-picker-sider');
    if (lmPerSideEl) lmPerSideEl.value = usage.lmPerSide != null ? String(usage.lmPerSide) : '';
    if (antallObjEl) antallObjEl.value = usage.antallObjekter != null && usage.antallObjekter !== '' ? String(usage.antallObjekter) : '1';
    if (siderEl) siderEl.value = usage.sider != null && usage.sider !== '' ? String(usage.sider) : '1';

    var initialBrand = products.some(function(product) { return product.name === options.initialBrand; })
        ? options.initialBrand
        : products[0].name;
    _kappePickerSelectedBrand = initialBrand;
    var initialDimensions = _getProductDimensionPickerDimensionsForBrand(initialBrand);
    var initialDim = _normalizeProductDimensionPickerDim(options.initialDim, initialDimensions);
    if (!initialDim && options.defaultFirstDimension && initialDimensions.length) initialDim = initialDimensions[0];
    _kappePickerSelectedDim = initialDim;

    _renderKappePickerTabs();
    _renderKappePickerDimensions();
    _updateKappePickerBreddeVisibility();

    overlay.classList.add('active');
    requestAnimationFrame(function() { _lockPopupSheetHeight('kappe-product-picker-overlay'); });
    return true;
}

function _updateKappePickerBreddeVisibility() {
    var product = _productDimensionPickerProducts.find(function(p) {
        return p && p.name === _kappePickerSelectedBrand;
    });
    var isFastener = product && product.type === 'festemiddel';
    // Festemiddel har ingen platemål. For å unngå at produktlisten "hopper" når
    // man bytter isolasjon ↔ festemiddel, beholdes plate-section-høyden: label+row
    // skjules og en placeholder-tekst med samme høyde vises i stedet.
    // Kjøres FØR showBredde-retur så det også gjelder iso-kort-undervelgeren.
    var plateSection = document.getElementById('product-dimension-picker-plate-section');
    if (plateSection) {
        if (!_productDimensionPickerShowPlate) {
            plateSection.style.display = 'none';
        } else {
            plateSection.style.display = '';
            var pLabel = document.getElementById('ppl-plate-label');
            var pRow = document.getElementById('ppl-plate-row');
            var pPlaceholder = document.getElementById('ppl-plate-placeholder');
            // visibility (ikke display) → label+row beholder layout-plass, så
            // seksjonshøyden er identisk for isolasjon og festemiddel.
            if (pLabel) pLabel.style.visibility = isFastener ? 'hidden' : '';
            if (pRow) pRow.style.visibility = isFastener ? 'hidden' : '';
            if (pPlaceholder) pPlaceholder.style.display = isFastener ? 'flex' : 'none';
        }
    }
    var section = document.getElementById('product-dimension-picker-bredde-section');
    if (!section) return;
    if (!_productDimensionPickerShowBredde) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    // Hvis aktiv modus ikke matcher produkttype, default til riktig modus.
    if (isFastener && ISO_MODES.indexOf(_kappePickerSpecMode) !== -1) {
        _kappePickerSpecMode = 'stk';
    } else if (!isFastener && FASTENER_MODES.indexOf(_kappePickerSpecMode) !== -1) {
        _kappePickerSpecMode = 'bredde';
    }
    var isoToggle = document.getElementById('kappe-picker-mode-toggle-iso');
    var fastToggle = document.getElementById('kappe-picker-mode-toggle-fast');
    if (isoToggle) isoToggle.style.display = isFastener ? 'none' : '';
    if (fastToggle) fastToggle.style.display = isFastener ? '' : 'none';
    _applyKappePickerSpecMode();
}

function _applyKappePickerSpecMode() {
    var plateWrap = document.getElementById('kappe-picker-spec-plate-wrap');
    var fastHint = document.getElementById('kappe-picker-fastener-hint');
    var usageWrap = document.getElementById('kappe-picker-iso-usage');
    var input = document.getElementById('kappe-picker-bredde-input');
    var btns = document.querySelectorAll('.kappe-picker-mode-btn');
    var mode = _kappePickerSpecMode;
    var isIso = ISO_MODES.indexOf(mode) !== -1;
    if (isIso) {
        // Isolasjon: Bredde/LM/Antall/Sider (usage-raden) kun i bredde-modus.
        // Plate-modus = hele plater → bare plate-dim trengs.
        if (plateWrap) plateWrap.style.display = '';
        if (fastHint) fastHint.style.display = 'none';
        if (usageWrap) usageWrap.style.display = (mode === 'bredde') ? '' : 'none';
        if (input && mode !== 'bredde') input.value = '';
    } else {
        // Festemiddel: skjul usage+plate, vis info-hint som forklarer Stk/Eske og
        // hvor antall fylles. Holder popupens høyde tilnærmet lik mellom moduser.
        if (plateWrap) plateWrap.style.display = 'none';
        if (fastHint) fastHint.style.display = '';
        if (usageWrap) usageWrap.style.display = 'none';
        if (input) input.value = '';
    }
    btns.forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    _updateKappeIsoTotal();
}

// Live-sum for isolasjon: total løpemeter = LM/side × Antall × Sider.
// Tom LM → ingen sum-tekst. Norsk desimal i visning.
function _updateKappeIsoTotal() {
    var totalEl = document.getElementById('kappe-picker-iso-total');
    if (!totalEl) return;
    var lmEl = document.getElementById('kappe-picker-lm-per-side');
    var antEl = document.getElementById('kappe-picker-antall-objekter');
    var sidEl = document.getElementById('kappe-picker-sider');
    var lm = lmEl ? parseLocaleNum(lmEl.value) : 0;
    if (!lm || lm <= 0 || isNaN(lm)) { totalEl.textContent = ''; return; }
    var ant = antEl ? parseLocaleNum(antEl.value) : 1;
    var sid = sidEl ? parseLocaleNum(sidEl.value) : 1;
    if (!ant || ant <= 0 || isNaN(ant)) ant = 1;
    if (!sid || sid <= 0 || isNaN(sid)) sid = 1;
    var total = lm * ant * sid;
    var rounded = Math.round(total * 100) / 100;
    totalEl.textContent = '= ' + String(rounded).replace('.', ',') + ' lm';
}
window._updateKappeIsoTotal = _updateKappeIsoTotal;

function _setKappePickerSpecMode(mode) {
    if (ISO_MODES.indexOf(mode) === -1 && FASTENER_MODES.indexOf(mode) === -1) return;
    _kappePickerSpecMode = mode;
    _applyKappePickerSpecMode();
    _lockPopupSheetHeight('kappe-product-picker-overlay');
}
window._setKappePickerSpecMode = _setKappePickerSpecMode;

function openKappeProductPicker(btn) {
    _currentKappeProductBtn = btn;
    var hiddenInput = btn.parentElement.querySelector('.kappe-line-product');
    var currentValue = hiddenInput ? hiddenInput.value : '';
    // Kun isolasjon-produkter. Festemiddel velges i den egne Festemidler-
    // seksjonen (egen picker), ikke pr. kappelinje.
    var products = getKappeProducts();
    var parsed = _parseProductDimensionValue(currentValue, products);
    var plate = null;
    var card = btn.closest('.kappe-line-card');
    if (card) {
        var lineLen = card.querySelector('.kappe-line-plate-length');
        var lineWid = card.querySelector('.kappe-line-plate-width');
        plate = {
            length: lineLen ? lineLen.value : '',
            width: lineWid ? lineWid.value : ''
        };
    }
    var opened = openProductDimensionPicker({
        title: t('kappe_col_produkt'),
        showPlate: true,
        initialBrand: parsed.brand,
        initialDim: parsed.dim,
        plate: plate,
        // "Fjern produkt" kun når noe er valgt (nullstiller linjen så et
        // festemiddel-bare-skjema er mulig).
        onClear: currentValue ? function() { _clearKappeLineProduct(btn); } : null,
        onConfirm: function(selection) {
            selectKappeProduct(selection.value);
        }
    });
    if (!opened) _currentKappeProductBtn = null;
}

// Nullstiller en kappelinjes produkt → tilbake til "Velg produkt..."-state.
// Linjen blir tom (uten produkt) og hoppes over i eksport.
function _clearKappeLineProduct(btn) {
    var card = btn && btn.closest ? btn.closest('.kappe-line-card') : null;
    if (!card) return;
    var hidden = card.querySelector('.kappe-line-product');
    if (hidden) { hidden.value = ''; hidden.dispatchEvent(new Event('change', { bubbles: true })); }
    var textSpan = card.querySelector('.kappe-line-product-text');
    if (textSpan) {
        textSpan.textContent = t('kappe_product_placeholder');
        textSpan.classList.add('kappe-line-product-text-placeholder');
    }
    var hint = card.querySelector('.kappe-line-product-plate-hint');
    if (hint) hint.remove();
    // Tøm kapp/plate-rader så ingen skjult data henger igjen.
    var kr = card.querySelector('.kappe-kapp-rows'); if (kr) kr.innerHTML = '';
    var pr = card.querySelector('.kappe-plate-rows'); if (pr) pr.innerHTML = '';
    var pickHint = card.querySelector('.kappe-line-pick-hint');
    if (pickHint) pickHint.style.display = '';
    var isoSec = card.querySelector('.kappe-iso-sections');
    if (isoSec) isoSec.style.display = 'none';
    renumberKappeLines();
    if (typeof updateKappeRequiredIndicators === 'function') updateKappeRequiredIndicators();
    sessionStorage.setItem('firesafe_kappe_current', JSON.stringify(getKappeFormData()));
}

function _renderKappePickerTabs(products) {
    products = products || _productDimensionPickerProducts;
    var brandsEl = document.getElementById('kappe-picker-brands-list');
    if (!brandsEl) return;
    if (!products.length) {
        brandsEl.innerHTML = '';
        return;
    }
    // Beholder iso-først-rekkefølge for logisk gruppering, men ingen text-headere.
    // Type signaliseres med farget prikk-prefiks per rad (oransje = isolasjon, grå = festemiddel).
    var isolasjon = [];
    var festemiddel = [];
    products.forEach(function(p) {
        if (p && p.type === 'festemiddel') festemiddel.push(p);
        else isolasjon.push(p);
    });

    function renderRow(p) {
        var sel = (p.name === _kappePickerSelectedBrand) ? ' kappe-product-picker-row-selected' : '';
        var safe = _escapeKappePickerJs(p.name);
        var dotCls = p.type === 'festemiddel'
            ? 'kappe-picker-type-dot kappe-picker-type-dot-fast'
            : 'kappe-picker-type-dot kappe-picker-type-dot-iso';
        // Multi-modus: vis antall valgte dimensjoner for produktet.
        var cnt = 0;
        if (_productDimensionPickerMultiDim) {
            cnt = _kappePickerSelectedPairs.filter(function(pr) { return pr.name === p.name; }).length;
        }
        var badge = cnt > 0 ? '<span class="kappe-picker-sel-badge">' + cnt + '</span>' : '';
        return '<div class="kappe-product-picker-row' + sel + '" onclick="_selectKappePickerBrand(\'' + safe + '\')">' +
            '<span class="' + dotCls + '" aria-hidden="true"></span>' +
            '<span class="kappe-product-picker-name">' + escapeHtml(p.name) + '</span>' +
            badge +
        '</div>';
    }

    var html = '';
    html += isolasjon.map(renderRow).join('');
    html += festemiddel.map(renderRow).join('');
    brandsEl.innerHTML = html;
}

function _selectKappePickerBrand(brand) {
    _kappePickerSelectedBrand = brand;
    var dims = _getProductDimensionPickerDimensionsForBrand(brand);
    // Multi-modus: valg BEVARES på tvers av produkter ({name,dim}-par).
    // Bytte produkt nullstiller IKKE — viser bare dette produktets dims med
    // hake for de som allerede er valgt for det produktet.
    if (_productDimensionPickerMultiDim) {
        _kappePickerSelectedDim = '';
    } else {
        var normalizedDim = _normalizeProductDimensionPickerDim(_kappePickerSelectedDim, dims);
        _kappePickerSelectedDim = normalizedDim || (dims.length ? dims[0] : '');
    }
    _renderKappePickerTabs();
    _renderKappePickerDimensions();
    _updateKappePickerBreddeVisibility();
    // Auto-fyll plate-input fra produktets tildelte plate (eller fallback til default).
    if (_productDimensionPickerShowBredde && typeof getKappePlateForProduct === 'function') {
        var plateLenEl = document.getElementById('kappe-picker-spec-plate-length');
        var plateWidEl = document.getElementById('kappe-picker-spec-plate-width');
        if (plateLenEl && plateWidEl) {
            // Sjekk om bruker har endret plate manuelt — hvis ikke, oppdater
            var assigned = getKappePlateForProduct(brand);
            // Bytt alltid til tildelt plate når brand byttes; bruker kan deretter override
            plateLenEl.value = assigned.length;
            plateWidEl.value = assigned.width;
        }
    }
    // Topp-plate-section (showPlate-modus, bl.a. iso-kort-undervelgeren): samme
    // auto-fyll så plate matcher valgt produkts tildelte plate ved brand-bytte.
    if (_productDimensionPickerShowPlate && typeof getKappePlateForProduct === 'function') {
        var topLenEl = document.getElementById('kappe-picker-plate-length');
        var topWidEl = document.getElementById('kappe-picker-plate-width');
        if (topLenEl && topWidEl) {
            var assignedTop = getKappePlateForProduct(brand);
            topLenEl.value = assignedTop.length;
            topWidEl.value = assignedTop.width;
        }
    }
    _lockPopupSheetHeight('kappe-product-picker-overlay');
}

function _selectKappePickerDim(dim) {
    _kappePickerSelectedDim = dim;
    _renderKappePickerDimensions();
}

function _getProductDimensionPickerDimensionsForBrand(brand) {
    var dims;
    if (_productDimensionPickerGetDimensionsForProduct) {
        var product = _productDimensionPickerProducts.find(function(p) {
            return p && p.name === brand;
        });
        dims = _productDimensionPickerGetDimensionsForProduct(product || { name: brand });
    } else {
        dims = _productDimensionPickerDimensions;
    }
    dims = (dims || []).map(function(dim) {
        return String(dim || '').trim();
    }).filter(function(dim) {
        return !!dim;
    });
    _sortKappeNumeric(dims);
    return dims;
}

function _renderKappePickerDimensions(products) {
    products = products || _productDimensionPickerProducts;
    var listEl = document.getElementById('kappe-product-picker-list');
    if (!listEl) return;

    if (!products.length) {
        listEl.innerHTML = '<div class="kappe-product-picker-empty">' + t('kappe_settings_no_products') + '</div>';
        return;
    }

    var dims = _getProductDimensionPickerDimensionsForBrand(_kappePickerSelectedBrand);

    if (!dims.length) {
        listEl.innerHTML = '<div class="kappe-product-picker-empty">' + t('kappe_settings_no_dimensions') + '</div>';
        return;
    }

    listEl.innerHTML = dims.map(function(dim) {
        var isSel = _productDimensionPickerMultiDim
            ? (_kappePickerPairIndex(_kappePickerSelectedBrand, dim) !== -1)
            : (dim === _kappePickerSelectedDim);
        var sel = isSel ? ' kappe-product-picker-row-selected' : '';
        var safe = _escapeKappePickerJs(dim);
        var fn = _productDimensionPickerMultiDim ? '_toggleKappePickerDim' : '_selectKappePickerDim';
        return '<div class="kappe-product-picker-row' + sel + '" onclick="' + fn + '(\'' + safe + '\')">' +
            '<span class="kappe-product-picker-name">' + escapeHtml(_formatDimMm(dim)) + '</span>' +
            '</div>';
    }).join('');
}

// Indeks for {name,dim}-par i multi-utvalget (-1 = ikke valgt).
function _kappePickerPairIndex(name, dim) {
    for (var i = 0; i < _kappePickerSelectedPairs.length; i++) {
        if (_kappePickerSelectedPairs[i].name === name && _kappePickerSelectedPairs[i].dim === dim) return i;
    }
    return -1;
}

// Multi-modus: toggle {valgt produkt, dim}-par. Valg på andre produkter
// bevares (du kan velge flere festemidler hver med flere dimensjoner).
function _toggleKappePickerDim(dim) {
    var i = _kappePickerPairIndex(_kappePickerSelectedBrand, dim);
    if (i === -1) _kappePickerSelectedPairs.push({ name: _kappePickerSelectedBrand, dim: dim });
    else _kappePickerSelectedPairs.splice(i, 1);
    _renderKappePickerDimensions();
    _renderKappePickerTabs();
}
window._toggleKappePickerDim = _toggleKappePickerDim;

function confirmKappeProductPicker() {
    if (!_kappePickerSelectedBrand) {
        showNotificationModal(t('kappe_settings_no_products'));
        return;
    }
    // Multi-modus (festemiddel): én ELLER FLERE produkter, hver med én eller
    // flere dimensjoner. Callback kalles én gang pr. {produkt,dim}-par.
    if (_productDimensionPickerMultiDim) {
        var multiCb = _productDimensionPickerOnConfirmMulti;
        var perPairCb = _productDimensionPickerCallback;
        // Uten sync-callback kreves minst ett valg (gammel append-modus).
        if (!multiCb && !_kappePickerSelectedPairs.length) {
            showNotificationModal(t('kappe_settings_no_dimensions'));
            return;
        }
        // Fang produkter FØR close (close nullstiller state).
        var mProducts = _productDimensionPickerProducts.slice();
        var order = mProducts.map(function(p) { return p && p.name; });
        var pairs = _kappePickerSelectedPairs.slice();
        pairs.sort(function(a, b) {
            var oa = order.indexOf(a.name), ob = order.indexOf(b.name);
            if (oa !== ob) return oa - ob;
            var na = parseFloat(String(a.dim).replace(',', '.'));
            var nb = parseFloat(String(b.dim).replace(',', '.'));
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return String(a.dim).localeCompare(String(b.dim), 'no');
        });
        var enriched = pairs.map(function(pair) {
            var mProduct = mProducts.find(function(p) { return p && p.name === pair.name; }) || null;
            var mEnhet = _formatDimMm(pair.dim);
            return {
                name: pair.name, dim: pair.dim, enhet: mEnhet,
                value: pair.name + ' ' + mEnhet, product: mProduct,
                source: mProduct && mProduct.source ? mProduct.source : ''
            };
        });
        closeKappeProductPicker();
        if (multiCb) multiCb(enriched);
        else if (perPairCb) enriched.forEach(function(s) { perPairCb(s); });
        return;
    }
    if (_productDimensionPickerRequireDimension && !_kappePickerSelectedDim) {
        showNotificationModal(t('kappe_settings_no_dimensions'));
        return;
    }
    // Validering: bredde-modus krever utfylt bredde (eller bytt til Plate-modus).
    // Sjekker mot valgt produkt — festemiddel er unntatt siden bredde ikke gjelder der.
    if (_productDimensionPickerShowBredde && _kappePickerSpecMode === 'bredde') {
        var _validProd = _productDimensionPickerProducts.find(function(p) {
            return p && p.name === _kappePickerSelectedBrand;
        });
        var _validIsFastener = _validProd && _validProd.type === 'festemiddel';
        if (!_validIsFastener) {
            var breddeCheckEl = document.getElementById('kappe-picker-bredde-input');
            var breddeCheckVal = breddeCheckEl ? String(breddeCheckEl.value || '').trim() : '';
            if (!breddeCheckVal) {
                showNotificationModal('Fyll inn bredde, eller bytt til Plate-modus.');
                return;
            }
        }
    }
    var value;
    var enhet = '';
    if (_kappePickerSelectedDim) {
        enhet = _formatDimMm(_kappePickerSelectedDim);
        value = _kappePickerSelectedBrand + ' ' + enhet;
    } else {
        value = _kappePickerSelectedBrand;
    }
    if (_productDimensionPickerCallback) {
        var selectedProduct = _productDimensionPickerProducts.find(function(product) {
            return product && product.name === _kappePickerSelectedBrand;
        }) || null;
        var breddeVal = '';
        var specModeVal = '';
        var quantityUnitVal = '';
        var plateVal = null;
        var isFastenerSel = selectedProduct && selectedProduct.type === 'festemiddel';
        if (_productDimensionPickerShowBredde) {
            if (isFastenerSel) {
                // Festemiddel: stk eller eske (direkte enhets-valg, ingen ekstra dimensjon).
                specModeVal = _kappePickerSpecMode === 'eske' ? 'eske' : 'stk';
                quantityUnitVal = specModeVal;
            } else if (_kappePickerSpecMode === 'plate') {
                specModeVal = 'plate';
            } else {
                var breddeEl = document.getElementById('kappe-picker-bredde-input');
                breddeVal = breddeEl ? String(breddeEl.value || '').trim() : '';
                specModeVal = 'bredde';
            }
            // Plate-dim er relevant for isolasjon i begge moduser (kreves for kalkulering).
            if (!isFastenerSel) {
                var plateLenEl = document.getElementById('kappe-picker-spec-plate-length');
                var plateWidEl = document.getElementById('kappe-picker-spec-plate-width');
                var pl = plateLenEl ? String(plateLenEl.value || '').trim() : '';
                var pw = plateWidEl ? String(plateWidEl.value || '').trim() : '';
                if (pl || pw) plateVal = { length: pl, width: pw };
            }
        }
        // Isolasjon bredde-modus: les LM/Antall/Sider og beregn total løpemeter.
        var lmPerSideVal = '', antallObjVal = '', siderVal = '', computedTotalLm = '';
        if (!isFastenerSel && specModeVal === 'bredde') {
            var lmEl2 = document.getElementById('kappe-picker-lm-per-side');
            var antEl2 = document.getElementById('kappe-picker-antall-objekter');
            var sidEl2 = document.getElementById('kappe-picker-sider');
            lmPerSideVal = lmEl2 ? String(lmEl2.value || '').trim() : '';
            antallObjVal = antEl2 ? String(antEl2.value || '').trim() : '';
            siderVal = sidEl2 ? String(sidEl2.value || '').trim() : '';
            var lmNum = parseLocaleNum(lmPerSideVal);
            if (lmNum && lmNum > 0 && !isNaN(lmNum)) {
                var antNum = parseLocaleNum(antallObjVal);
                var sidNum = parseLocaleNum(siderVal);
                if (!antNum || antNum <= 0 || isNaN(antNum)) antNum = 1;
                if (!sidNum || sidNum <= 0 || isNaN(sidNum)) sidNum = 1;
                var totalNum = Math.round(lmNum * antNum * sidNum * 100) / 100;
                computedTotalLm = String(totalNum).replace('.', ',');
            }
        }
        _productDimensionPickerCallback({
            name: _kappePickerSelectedBrand,
            dim: _kappePickerSelectedDim || '',
            enhet: enhet,
            value: value,
            bredde: breddeVal,
            specMode: specModeVal,
            quantityUnit: quantityUnitVal,
            plate: plateVal,
            product: selectedProduct,
            source: selectedProduct && selectedProduct.source ? selectedProduct.source : '',
            lmPerSide: lmPerSideVal,
            antallObjekter: antallObjVal,
            sider: siderVal,
            computedTotalLm: computedTotalLm
        });
    }
    closeKappeProductPicker();
}

// Generisk popup-høyde-lås (CLAUDE.md "Popup-størrelse"): ratchet opp — en
// åpen popup krymper aldri mens den er åpen (ingen "hopp" ved toggle/tab).
// Tak ≤ 80vh; innholdet scroller internt over taket. Nullstilles ved lukking.
function _lockPopupSheetHeight(popupId) {
    var p = document.getElementById(popupId);
    if (!p || !p.classList.contains('active')) return;
    var sheet = p.querySelector('.spec-popup-sheet');
    if (!sheet) return;
    var cap = Math.round((window.innerHeight || 800) * 0.8);
    var prev = parseFloat(sheet.style.minHeight) || 0;
    var locked = Math.min(Math.max(prev, sheet.offsetHeight), cap);
    if (locked > 0) sheet.style.minHeight = locked + 'px';
}
window._lockPopupSheetHeight = _lockPopupSheetHeight;

function _unlockPopupSheetHeight(popupId) {
    var p = document.getElementById(popupId);
    if (!p) return;
    var sheet = p.querySelector('.spec-popup-sheet');
    if (sheet) sheet.style.minHeight = '';
}

// Topp-forankret + innholds-adaptiv (CLAUDE.md "Popup-størrelse"): forankrer
// popup-toppen på Y der den HØYESTE modusen ville vært sentrert, og lar høyden
// følge innholdet (ingen min-height-lås). Toppen — og dermed toggle-knappene —
// flytter seg ikke når man bytter modus; boksen krymper/vokser nedenfra, ingen
// tomrom. Offset ≥16px så `applyKeyboardLayout` (live getBoundingClientRect)
// beholder headroom til å løfte popupen over tastaturet.
// Topp-forankring (Apple-mønster: toppen/toggle står fast ved modus-bytte).
// Husker ønsket tallestH pr. popup, så den kan re-forankres når tastaturet
// lukkes. KRITISK: marginTop regnes fra FULL skjermhøyde. Når tastaturet er
// åpent ville den dyttet inputs/knapper bak tastaturet — derfor suspenderes
// forankringen mens tastaturet er åpent, og applyKeyboardLayout sin piksel-
// cap + translate eier posisjonen (eksakt som de fungerende confirm-modal-
// popupene). Reaktiveres automatisk når tastaturet lukkes.
var _pendingTopAnchors = {};

function _applyPopupTopAnchor(popupId, tallestH) {
    if (tallestH > 0) _pendingTopAnchors[popupId] = tallestH;
    var p = document.getElementById(popupId);
    if (!p || !p.classList.contains('active')) return;
    var sheet = p.querySelector('.spec-popup-sheet');
    if (!sheet) return;
    // Tastatur åpent (autoritativt via VirtualKeyboard API / viewport):
    // applyKeyboardLayout eier posisjonen — ikke sett konkurrerende
    // marginTop. body.keyboard-open er nå presis (ingen gjetting).
    if (document.body.classList.contains('keyboard-open')) {
        p.classList.remove('popup-top-anchored');
        sheet.style.marginTop = '';
        sheet.style.minHeight = '';
        return;
    }
    var vh = window.innerHeight || 800;
    var off = Math.round((vh - tallestH) / 2);
    if (off < 16) off = 16;
    p.classList.add('popup-top-anchored');
    sheet.style.minHeight = '';
    sheet.style.marginTop = off + 'px';
}
window._applyPopupTopAnchor = _applyPopupTopAnchor;

function _clearPopupTopAnchor(popupId) {
    delete _pendingTopAnchors[popupId];
    var p = document.getElementById(popupId);
    if (!p) return;
    p.classList.remove('popup-top-anchored');
    delete p.dataset.specKbd;
    var sheet = p.querySelector('.spec-popup-sheet');
    if (sheet) {
        sheet.style.marginTop = '';
        sheet.style.minHeight = '';
        sheet.style.removeProperty('max-height');
        sheet.style.transform = '';
        sheet.style.transition = '';
    }
}
window._clearPopupTopAnchor = _clearPopupTopAnchor;

// Kalt fra applyKeyboardLayout ved hver tastatur-tilstandsendring: når
// tastaturet er åpent fjernes topp-forankringens marginTop (cap/translate
// overtar); når det lukkes re-forankres aktive popuper fra husket høyde.
function _reconcileTopAnchorsForKeyboard(keyboardOpen) {
    Object.keys(_pendingTopAnchors).forEach(function(popupId) {
        var p = document.getElementById(popupId);
        if (!p || !p.classList.contains('active')) return;
        var sheet = p.querySelector('.spec-popup-sheet');
        if (!sheet) return;
        if (keyboardOpen) {
            // applyKeyboardLayout eier posisjonen — ikke sett konkurrerende
            // marginTop (ga «hopp» ved åpning/Stk-Meter-bytte).
            p.classList.remove('popup-top-anchored');
            sheet.style.marginTop = '';
            sheet.style.minHeight = '';
        } else {
            var vh = window.innerHeight || 800;
            var off = Math.round((vh - _pendingTopAnchors[popupId]) / 2);
            if (off < 16) off = 16;
            p.classList.add('popup-top-anchored');
            sheet.style.minHeight = '';
            sheet.style.marginTop = off + 'px';
        }
    });
}
window._reconcileTopAnchorsForKeyboard = _reconcileTopAnchorsForKeyboard;

// "Fjern produkt"-knapp i produkt-velgeren: nullstiller linjens produkt.
function clearKappeLineProductFromPicker() {
    var cb = _productDimensionPickerOnClear;
    closeKappeProductPicker();
    if (cb) cb();
}
window.clearKappeLineProductFromPicker = clearKappeLineProductFromPicker;

function closeKappeProductPicker() {
    var overlay = document.getElementById('kappe-product-picker-overlay');
    overlay.classList.remove('active');
    _unlockPopupSheetHeight('kappe-product-picker-overlay');
    _currentKappeProductBtn = null;
    _productDimensionPickerCallback = null;
    _productDimensionPickerProducts = [];
    _productDimensionPickerDimensions = [];
    _productDimensionPickerGetDimensionsForProduct = null;
    _productDimensionPickerShowPlate = true;
    _productDimensionPickerShowBredde = false;
    _productDimensionPickerRequireDimension = false;
    _productDimensionPickerMultiDim = false;
    _productDimensionPickerOnConfirmMulti = null;
    _productDimensionPickerOnClear = null;
    _kappePickerSelectedBrand = null;
    _kappePickerSelectedDim = null;
    _kappePickerSelectedPairs = [];
    _kappePickerSpecMode = 'bredde';
    var breddeSection = document.getElementById('product-dimension-picker-bredde-section');
    if (breddeSection) breddeSection.style.display = 'none';
    var isoToggle = document.getElementById('kappe-picker-mode-toggle-iso');
    var fastToggle = document.getElementById('kappe-picker-mode-toggle-fast');
    if (isoToggle) isoToggle.style.display = '';
    if (fastToggle) fastToggle.style.display = 'none';
    // Vis iso-kort-popupen igjen hvis undervelgeren ble åpnet derfra.
    if (typeof _showIsoCardAfterPicker === 'function') _showIsoCardAfterPicker();
}

function selectKappeProduct(value, selection) {
    if (!_currentKappeProductBtn) return;
    var wrap = _currentKappeProductBtn.parentElement;
    var hiddenInput = wrap.querySelector('.kappe-line-product');
    var textSpan = _currentKappeProductBtn.querySelector('.kappe-line-product-text');
    if (hiddenInput) {
        hiddenInput.value = value;
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (textSpan) {
        textSpan.textContent = value;
        textSpan.classList.remove('kappe-line-product-text-placeholder');
    }
    // Lagre plate-verdier fra picker-popup til linjens skjulte plate-felter
    var card = _currentKappeProductBtn.closest('.kappe-line-card');
    var newLen = '';
    var newWid = '';
    if (card) {
        var pickerLen = document.getElementById('kappe-picker-plate-length');
        var pickerWid = document.getElementById('kappe-picker-plate-width');
        var def = _getDefaultPlate();
        newLen = (pickerLen && pickerLen.value && pickerLen.value.trim()) || def.lengde;
        newWid = (pickerWid && pickerWid.value && pickerWid.value.trim()) || def.bredde;
        var plateLenEl = card.querySelector('.kappe-line-plate-length');
        var plateWidEl = card.querySelector('.kappe-line-plate-width');
        if (plateLenEl) plateLenEl.value = newLen;
        if (plateWidEl) plateWidEl.value = newWid;
    }
    // Oppdater plate-hint-span inne i info-wrapperen (legg til hvis mangler)
    var btn = _currentKappeProductBtn;
    var infoWrap = btn.querySelector('.kappe-line-product-info');
    var existingHint = btn.querySelector('.kappe-line-product-plate-hint');
    if (newLen && newWid) {
        var hintText = newLen + '×' + newWid;
        if (existingHint) {
            existingHint.textContent = hintText;
        } else if (infoWrap) {
            var hintEl = document.createElement('span');
            hintEl.className = 'kappe-line-product-plate-hint';
            hintEl.textContent = hintText;
            infoWrap.appendChild(hintEl);
        }
    } else if (existingHint) {
        existingHint.remove();
    }
    // Produkt valgt → skjul "velg produkt"-hinten, vis kapp/plate-seksjonene.
    if (card) {
        var pickHint = card.querySelector('.kappe-line-pick-hint');
        if (pickHint) pickHint.style.display = 'none';
        var isoSec = card.querySelector('.kappe-iso-sections');
        if (isoSec) isoSec.style.display = '';
        renumberKappeLines();
    }
    closeKappeProductPicker();
}

// ─── Isolerings-kort-popup (kappeskjema-kort-stil) ──────────────────────────
// Lag 1: produkt-knapp + Bredde/Plate-toggle + Bredde/LM/Antall/Sider.
// Produkt-knappen åpner Lag 2 (eksisterende openProductDimensionPicker,
// gjenbrukt uendret som ren produkt+dim+plate-undervelger).

var _isoCardCallback = null;
var _isoCardMode = 'bredde';
var _isoCardSelected = null; // { name, enhet, dim, plate:{length,width}, source }

// Bredde-modus støtter flere linjer per produkt (som kappeskjema "+ Legg til kapp").
function _createIsoCardRow(data) {
    var d = data || {};
    var row = document.createElement('div');
    row.className = 'iso-card-row iso-card-row--calc';
    // Valgt kutteretning for raden ('' = auto/mest svinn, 'L' = langs
    // platelengde, 'W' = langs platebredde). Bevares ved re-redigering.
    row.dataset.iscOrient = d.kappeOrient || '';
    row.innerHTML =
        '<div class="iso-card-row-main">' +
            '<div class="kappe-quad-row">' +
                '<div class="mobile-field field-required"><label data-i18n="iso_bredde">Bredde</label>' +
                    '<input type="text" class="isc-bredde" inputmode="numeric" pattern="[0-9]*" placeholder="mm" value="' + escapeHtml(d.bredde || '') + '" oninput="_updateIsoCardTotal()"></div>' +
                '<div class="mobile-field field-required"><label data-i18n="iso_lm_per_side">LM</label>' +
                    '<input type="text" class="isc-lm" inputmode="decimal" pattern="[0-9,.]*" value="' + escapeHtml(d.lopemeter || '') + '" oninput="_updateIsoCardTotal()"></div>' +
                '<div class="mobile-field field-required"><label data-i18n="iso_antall_objekter">Antall</label>' +
                    '<input type="text" class="isc-antall" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(d.antall || '') + '" oninput="_updateIsoCardTotal()"></div>' +
                '<div class="mobile-field field-required"><label data-i18n="iso_sider">Sider</label>' +
                    '<input type="text" class="isc-sider" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(d.sider || '') + '" oninput="_updateIsoCardTotal()"></div>' +
            '</div>' +
            '<button type="button" class="kappe-kapp-remove-btn" onclick="_isoCardRemoveRow(this)" title="Fjern rad">' + deleteIcon + '</button>' +
        '</div>' +
        '<div class="iso-card-row-plates"></div>';
    return row;
}

function _isoCardBlockOf(el) {
    return (el && el.closest) ? el.closest('.iso-card-block') : null;
}

// Bygg én produkt-blokk: egen produkt-velger + egne kapp/plate-rader.
// block._sel bærer valgt isolasjonsprodukt for nettopp denne blokken.
function _createIsoCardBlock(sel) {
    var block = document.createElement('div');
    block.className = 'iso-card-block';
    block._sel = (sel && sel.name) ? {
        name: sel.name || '', enhet: sel.enhet || '',
        dim: sel.dim || sel.enhet || '',
        plate: sel.plate || null, source: 'kappe-products', isFastener: false
    } : null;
    var disp = (sel && sel.name)
        ? (sel.enhet ? sel.name + ' ' + _formatDimMm(sel.enhet) : sel.name)
        : '';
    var plate = (sel && sel.plate) ? sel.plate : null;
    var slotHtml = _kappeProductPickerHtml(disp, plate ? plate.length : '', plate ? plate.width : '')
        .replace('openKappeProductPicker(this)', '_openIsoCardProductSubpicker(this)');
    block.innerHTML =
        '<div class="iso-card-block-head">' +
            '<label class="iso-card-label" data-i18n="kappe_col_produkt">Produkt</label>' +
            '<button type="button" class="iso-card-block-remove" onclick="_isoCardRemoveProductBlock(this)" title="Fjern produkt">' + deleteIcon + '</button>' +
        '</div>' +
        '<div class="iso-block-product-slot">' + slotHtml + '</div>' +
        '<div class="iso-block-kapp-rows"></div>' +
        '<div class="iso-block-plate-rows"></div>' +
        '<div class="kappe-add-row-buttons">' +
            '<button type="button" class="kappe-add-kapp-btn" onpointerdown="event.preventDefault()" onclick="_isoCardAddRow(this)">+ <span data-i18n="kappe_add_kapp">Legg til kapp</span></button>' +
            '<button type="button" class="kappe-add-kapp-btn" onpointerdown="event.preventDefault()" onclick="_isoCardAddPlateRow(this)">+ <span data-i18n="kappe_add_plate">Legg til plate</span></button>' +
        '</div>';
    return block;
}

function _isoCardAddProductBlock() {
    var c = document.getElementById('iso-card-blocks');
    if (!c) return;
    var newBlock = _createIsoCardBlock(null);
    c.appendChild(newBlock);
    _updateIsoCardBlockRemoveStates();
    if (typeof applyTranslations === 'function') applyTranslations();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
    _isoCardScrollRowIntoView(newBlock);
}
window._isoCardAddProductBlock = _isoCardAddProductBlock;

function _isoCardRemoveProductBlock(btn) {
    var c = document.getElementById('iso-card-blocks');
    var block = _isoCardBlockOf(btn);
    if (!c || !block) return;
    block.remove();
    // Hold alltid minst én blokk (produkt-velgeren skal alltid være synlig).
    if (c.querySelectorAll('.iso-card-block').length === 0) {
        c.appendChild(_createIsoCardBlock(null));
        if (typeof applyTranslations === 'function') applyTranslations();
    }
    _updateIsoCardBlockRemoveStates();
    _updateIsoCardTotal();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window._isoCardRemoveProductBlock = _isoCardRemoveProductBlock;

// Fjern-produkt-knappen disables når kun én blokk finnes (siste produkt-
// velger skal alltid være synlig — kan ikke fjernes helt bort).
function _updateIsoCardBlockRemoveStates() {
    var c = document.getElementById('iso-card-blocks');
    if (!c) return;
    var blocks = c.querySelectorAll('.iso-card-block');
    blocks.forEach(function(bl) {
        var rm = bl.querySelector('.iso-card-block-remove');
        if (rm) rm.disabled = blocks.length <= 1;
    });
}

function _isoCardAddRow(btn) {
    var block = _isoCardBlockOf(btn);
    var container = block ? block.querySelector('.iso-block-kapp-rows') : null;
    if (!container) return;
    var newRow = _createIsoCardRow({});
    container.appendChild(newRow);
    // Fokus den nye radens første felt SYNKRONT i samme tap-gest, så
    // skjermtastaturet forblir åpent (slipper å trykke på feltet igjen).
    var firstInp = newRow.querySelector('.isc-bredde');
    if (firstInp) { try { firstInp.focus({ preventScroll: true }); } catch (e) { firstInp.focus(); } }
    _updateIsoCardTotal();
    if (typeof applyTranslations === 'function') applyTranslations();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
    _isoCardScrollRowIntoView(newRow);
}

// Scroll den nye/aktive raden inn i synlig område i #iso-card-scroll.
// preventScroll på focus() hindrer browserens auto-scroll (unngår hopp),
// så vi scroller eksplisitt etter at layout/applyKeyboardLayout har satt
// seg (neste frame), slik at raden + «+ Legg til»-knappene er synlige.
function _isoCardScrollRowIntoView(row) {
    if (!row) return;
    var scroller = document.getElementById('iso-card-scroll');
    function doScroll() {
        if (!row || !row.isConnected) return;
        if (scroller && scroller.contains(row)) {
            // Eksplisitt scroll av selve den interne containeren. getBounding-
            // ClientRect-delta er upåvirket av popup-transform (begge i samme
            // transformerte popup), så dette er robust med tastatur åpent.
            var elRect = row.getBoundingClientRect();
            var scRect = scroller.getBoundingClientRect();
            var delta = (elRect.top - scRect.top);
            var target = scroller.scrollTop + delta
                - Math.max(0, (scroller.clientHeight - row.offsetHeight) / 2);
            var maxScroll = scroller.scrollHeight - scroller.clientHeight;
            scroller.scrollTop = Math.max(0, Math.min(target, maxScroll));
        } else if (row.scrollIntoView) {
            try { row.scrollIntoView({ block: 'center' }); } catch (e) {}
        }
    }
    // To rAF: etter layout/applyKeyboardLayout. + settle-fallback (350ms)
    // fordi applyKeyboardLayout har en 250ms settle-timer som kan re-
    // translere popupen etter tastatur-animasjon.
    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            doScroll();
            setTimeout(doScroll, 350);
        });
    });
}
window._isoCardAddRow = _isoCardAddRow;

function _isoCardRemoveRow(btn) {
    // Kapp-rader er valgfrie (on-demand som kappeskjema) — fjern ned til 0.
    var row = btn.closest('.iso-card-row');
    if (row) row.remove();
    _updateIsoCardTotal();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window._isoCardRemoveRow = _isoCardRemoveRow;

// Beholdt som no-op — rad-fjerning er alltid tillatt (ingen min-grense).
function _updateIsoCardRemoveStates() {}
function _updateRowsRemoveStates() {}

// Plate-modus: flere "Antall plater"-linjer per produkt (speiler Stk-multirad).
function _createIsoCardPlateRow(data) {
    var d = data || {};
    var row = document.createElement('div');
    row.className = 'iso-card-row iso-card-row--calc';
    row.innerHTML =
        '<div class="iso-card-row-main">' +
            '<div class="kappe-quad-row">' +
                '<div class="mobile-field field-required"><label data-i18n="iso_plate_count">Antall plater</label>' +
                    '<input type="text" class="isc-plate-antall" inputmode="decimal" pattern="[0-9,.]*" value="' + escapeHtml(d.antall || '') + '" oninput="_updateIsoCardTotal()"></div>' +
            '</div>' +
            '<button type="button" class="kappe-kapp-remove-btn" onclick="_isoCardRemovePlateRow(this)" title="Fjern rad">' + deleteIcon + '</button>' +
        '</div>' +
        '<div class="iso-card-row-plates"></div>';
    return row;
}
function _isoCardAddPlateRow(btn) {
    var block = _isoCardBlockOf(btn);
    var c = block ? block.querySelector('.iso-block-plate-rows') : null;
    if (!c) return;
    var newRow = _createIsoCardPlateRow({});
    c.appendChild(newRow);
    var firstInp = newRow.querySelector('.isc-plate-antall');
    if (firstInp) { try { firstInp.focus({ preventScroll: true }); } catch (e) { firstInp.focus(); } }
    _updateIsoCardModeIndicators();
    if (typeof applyTranslations === 'function') applyTranslations();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
    _isoCardScrollRowIntoView(newRow);
}
window._isoCardAddPlateRow = _isoCardAddPlateRow;
function _isoCardRemovePlateRow(btn) {
    // Plate-rader er valgfrie — fjern ned til 0.
    var row = btn.closest('.iso-card-row');
    if (row) row.remove();
    _updateIsoCardModeIndicators();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window._isoCardRemovePlateRow = _isoCardRemovePlateRow;

// Festemiddel-modus: flere "Antall"-linjer per produkt.
// Festemiddel-rad i iso-popupen: bærer eget produkt/dim/enhet (valgt via
// "+ Legg til festemiddel"-fler-velgeren). Label + antall-felt + fjern.
function _createIsoCardFastenerRow(data) {
    var d = data || {};
    var nm = (d.name || '') + (d.enhet ? ' ' + _formatDimMm(d.enhet) : '');
    var row = document.createElement('div');
    row.className = 'iso-card-row iso-card-fast-row';
    row.dataset.fname = d.name || '';
    row.dataset.fenhet = d.enhet || '';
    row.dataset.fdim = d.dim || d.enhet || '';
    row.dataset.fsource = d.source || 'kappe-fastener';
    row.innerHTML =
        '<span class="iso-card-fast-name">' + escapeHtml(nm) + '</span>' +
        '<div class="kappe-quad-row">' +
            '<div class="mobile-field"><label>' + escapeHtml(t('kappe_unit_stk')) + '</label>' +
                '<input type="text" class="isc-fast-stk" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(d.stk || '') + '"></div>' +
            '<div class="mobile-field"><label>' + escapeHtml(t('kappe_unit_eske')) + '</label>' +
                '<input type="text" class="isc-fast-eske" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(d.eske || '') + '"></div>' +
        '</div>' +
        '<button type="button" class="kappe-kapp-remove-btn" onclick="_isoCardRemoveFastenerRow(this)" title="Fjern rad">' + deleteIcon + '</button>';
    return row;
}
function _isoCardRemoveFastenerRow(btn) {
    // Festemiddel-rader er valgfrie — tillat å fjerne helt ned til 0.
    var row = btn.closest('.iso-card-row');
    if (row) row.remove();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window._isoCardRemoveFastenerRow = _isoCardRemoveFastenerRow;

// Produkt-/festemiddel-undervelgeren legger seg oppå iso-kort-popupen. Skjul
// iso-kortet mens undervelgeren er åpen (samme mønster som dag-timer ↔ plan)
// så man ikke ser «Isolering» bak. Gjenopprettes når undervelgeren lukkes.
function _hideIsoCardForPicker() {
    var p = document.getElementById('iso-card-popup');
    if (p && p.classList.contains('active')) {
        p.classList.add('iso-card-popup--hidden');
        window._isoCardHiddenForPicker = true;
    }
}
function _showIsoCardAfterPicker() {
    var p = document.getElementById('iso-card-popup');
    if (p) p.classList.remove('iso-card-popup--hidden');
    window._isoCardHiddenForPicker = false;
}

// "+ Legg til festemiddel" i materiale-pickeren: åpner fler-velgeren for
// festemidler (Brannskruer/Stift + flere dimensjoner, som kappeskjema).
// Valgte festemidler legges som materiale-valg i ordreseddelen.
function _isoCardOpenFastenerPicker() {
    var fasteners = (typeof getKappeFastenerProducts === 'function' ? getKappeFastenerProducts() : []).map(function(p) {
        return Object.assign({}, p, { source: p.name === MATERIAL_STIFT_LAUNCHER ? 'kappe-stift' : 'kappe-fastener' });
    });
    if (!fasteners.length) { showNotificationModal(t('kappe_settings_no_products')); return; }
    var dims = typeof getKappeFastenerDimensions === 'function' ? getKappeFastenerDimensions() : [];
    // Match dimensjoner på FORMATERT form ("10" og "10mm" er samme), og bruk
    // pickerens eksakte rå-verdi så avhuking treffer.
    function _isoFastNormDim(want) {
        var w = _formatDimMm(String(want || '').trim());
        for (var k = 0; k < dims.length; k++) {
            if (_formatDimMm(String(dims[k] || '').trim()) === w) return String(dims[k]);
        }
        return String(want || '');
    }
    // Forhåndsvelg det som allerede ligger som festemiddel-rader.
    var fc = document.getElementById('iso-card-fastener-rows');
    var initialPairs = [];
    if (fc) {
        fc.querySelectorAll('.iso-card-fast-row').forEach(function(row) {
            initialPairs.push({
                name: row.dataset.fname || '',
                dim: _isoFastNormDim(row.dataset.fdim || row.dataset.fenhet || '')
            });
        });
    }
    _hideIsoCardForPicker();
    openProductDimensionPicker({
        title: t('kappe_section_fasteners'),
        products: fasteners,
        dimensions: dims,
        showPlate: false,
        requireDimension: true,
        multiDimension: true,
        initialPairs: initialPairs,
        // Synk festemiddel-radene til valgte par: behold Stk/Eske på
        // eksisterende, legg til nye, fjern fravalgte. Popupen forblir åpen.
        onConfirmMulti: function(pairs) {
            var c = document.getElementById('iso-card-fastener-rows');
            if (!c) return;
            var prev = {};
            c.querySelectorAll('.iso-card-fast-row').forEach(function(row) {
                var key = (row.dataset.fname || '') + '||' + _formatDimMm(String(row.dataset.fdim || row.dataset.fenhet || '').trim());
                prev[key] = {
                    stk: (row.querySelector('.isc-fast-stk') || {}).value || '',
                    eske: (row.querySelector('.isc-fast-eske') || {}).value || ''
                };
            });
            c.innerHTML = '';
            (pairs || []).forEach(function(p) {
                var pv = prev[(p.name || '') + '||' + _formatDimMm(String(p.dim || '').trim())] || { stk: '', eske: '' };
                c.appendChild(_createIsoCardFastenerRow({
                    name: p.name,
                    enhet: p.enhet || '',
                    dim: p.dim || '',
                    source: (p.product && p.product.source) ? p.product.source : 'kappe-fastener',
                    stk: pv.stk,
                    eske: pv.eske
                }));
            });
            if (typeof applyTranslations === 'function') applyTranslations();
            _anchorIsoCardTop();
            if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
            var fRows = c.querySelectorAll('.iso-card-fast-row');
            _isoCardScrollRowIntoView(
                fRows.length ? fRows[fRows.length - 1] : document.querySelector('.iso-card-fast-section')
            );
        }
    });
}
window._isoCardOpenFastenerPicker = _isoCardOpenFastenerPicker;

// Fyll en blokks kapp/plate-rader fra prefill (re-redigering av ett produkt).
// Isolasjon (som kappeskjema): INGEN default-rad — kun raden fra prefill.
function _isoCardFillBlockRows(block, prefill) {
    prefill = prefill || {};
    if (!block) return;
    var rowsEl = block.querySelector('.iso-block-kapp-rows');
    var plateEl = block.querySelector('.iso-block-plate-rows');
    if (prefill.specMode === 'plate') {
        if (plateEl) plateEl.appendChild(_createIsoCardPlateRow({ antall: prefill.antall || prefill.computedTotalLm || '' }));
    } else if (prefill.bredde || prefill.lmPerSide || prefill.antallObjekter || prefill.sider) {
        if (rowsEl) rowsEl.appendChild(_createIsoCardRow({
            bredde: prefill.bredde ? String(prefill.bredde).replace(/mm$/i, '') : '',
            lopemeter: prefill.lmPerSide != null ? String(prefill.lmPerSide) : '',
            antall: prefill.antallObjekter != null && prefill.antallObjekter !== '' ? String(prefill.antallObjekter) : '',
            sider: prefill.sider != null && prefill.sider !== '' ? String(prefill.sider) : '',
            kappeOrient: prefill.kappeOrient || ''
        }));
    }
}

// Gjenåpne iso-popupen forhåndsfylt med ALLE tidligere valg (fra materiale-
// pickeren). Isolasjon-rader (kapp/plate) bruker FØRSTE iso-produkt som
// produkt-velger; festemiddel-rader bærer eget produkt.
function _isoCardBuildFromEntries(entries) {
    var blocksC = document.getElementById('iso-card-blocks');
    var fastEl = document.getElementById('iso-card-fastener-rows');
    if (blocksC) blocksC.innerHTML = '';
    if (fastEl) fastEl.innerHTML = '';

    var isoEntries = [], fastEntries = [];
    (entries || []).forEach(function(e) {
        if (e && (e.source === 'kappe-stift' || e.source === 'kappe-fastener')) fastEntries.push(e);
        else if (e) isoEntries.push(e);
    });

    // Grupper iso-rader pr. produkt (navn|enhet|plate) → én blokk pr. produkt.
    var groups = [], gmap = {};
    isoEntries.forEach(function(e) {
        var plate = (e.plate && (e.plate.length || e.plate.width))
            ? { length: e.plate.length || '', width: e.plate.width || '' } : null;
        var key = (e.name || '').toLowerCase() + '|' + (e.enhet || '').toLowerCase() +
            '|' + (plate ? plate.length + 'x' + plate.width : '');
        var g = gmap[key];
        if (!g) {
            g = gmap[key] = { sel: { name: e.name || '', enhet: e.enhet || '', dim: e.enhet || '', plate: plate }, items: [] };
            groups.push(g);
        }
        g.items.push(e);
    });

    if (blocksC) {
        if (!groups.length) {
            blocksC.appendChild(_createIsoCardBlock(null));
        } else {
            groups.forEach(function(g) {
                var block = _createIsoCardBlock(g.sel);
                blocksC.appendChild(block);
                var re = block.querySelector('.iso-block-kapp-rows');
                var pe = block.querySelector('.iso-block-plate-rows');
                g.items.forEach(function(e) {
                    if (e.specMode === 'plate') {
                        if (pe) pe.appendChild(_createIsoCardPlateRow({ antall: e.antall || e.computedTotalLm || '' }));
                    } else if (re) {
                        re.appendChild(_createIsoCardRow({
                            bredde: e.bredde ? String(e.bredde).replace(/mm$/i, '') : '',
                            lopemeter: e.lmPerSide != null ? String(e.lmPerSide) : '',
                            antall: e.antallObjekter != null ? String(e.antallObjekter) : '',
                            sider: e.sider != null ? String(e.sider) : '',
                            kappeOrient: e.kappeOrient || ''
                        }));
                    }
                });
            });
        }
    }

    fastEntries.forEach(function(e) {
        if (fastEl) fastEl.appendChild(_createIsoCardFastenerRow({
            name: e.name || '',
            enhet: e.enhet || '',
            dim: e.dim || e.enhet || '',
            source: e.source || 'kappe-fastener',
            stk: e.specMode === 'eske' ? '' : (e.antall || ''),
            eske: e.specMode === 'eske' ? (e.antall || '') : ''
        }));
    });
    _updateIsoCardBlockRemoveStates();
    _updateIsoCardTotal();
}

// Sørg for at den aktive modusens container har minst én rad (uten å tømme
// de andre — så data bevares ved fram/tilbake-toggling).
function _isoCardEnsureActiveRow() {
    // Kun festemiddel trenger en garantert rad. Isolasjon (kapp/plate) er
    // on-demand som kappeskjema — ingen auto-rad.
    if (!(_isoCardSelected && _isoCardSelected.isFastener)) return;
    var c = document.getElementById('iso-card-fastener-rows');
    if (c && c.querySelectorAll('.iso-card-row').length === 0) {
        c.appendChild(_createIsoCardFastenerRow({}));
        _updateRowsRemoveStates('iso-card-fastener-rows');
    }
}

function openIsoCardPopup(callback, prefill) {
    var popup = document.getElementById('iso-card-popup');
    if (!popup) return;
    _isoCardMaxH = 0;
    _isoCardCallback = callback || null;
    prefill = prefill || {};

    var titleEl = document.getElementById('iso-card-title');
    if (titleEl) titleEl.textContent = getMaterialKappeLabel();

    // Multi-prefill: gjenåpne med ALLE tidligere isolasjon/festemiddel-valg.
    if (prefill.entries && prefill.entries.length) {
        _isoCardBuildFromEntries(prefill.entries);
        popup.classList.add('active');
        if (typeof applyTranslations === 'function') applyTranslations();
        if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
        requestAnimationFrame(_anchorIsoCardTop);
        return;
    }

    var blocksC = document.getElementById('iso-card-blocks');
    var fastEl = document.getElementById('iso-card-fastener-rows');
    if (blocksC) blocksC.innerHTML = '';
    if (fastEl) fastEl.innerHTML = '';

    var prefillIsFastener = prefill.source === 'kappe-stift' || prefill.source === 'kappe-fastener';
    if (prefillIsFastener) {
        // Re-redigering av ett festemiddel: fast-rad + én tom iso-blokk.
        if (fastEl) fastEl.appendChild(_createIsoCardFastenerRow({
            name: prefill.name || '',
            enhet: prefill.enhet || prefill.dim || '',
            dim: prefill.dim || prefill.enhet || '',
            source: prefill.source || 'kappe-fastener',
            stk: prefill.specMode === 'eske' ? '' : (prefill.antall || ''),
            eske: prefill.specMode === 'eske' ? (prefill.antall || '') : ''
        }));
        if (blocksC) blocksC.appendChild(_createIsoCardBlock(null));
    } else {
        var prefillName = prefill.name ? (_getKappeProductName(prefill.name) || prefill.name) : '';
        var plate = prefill.plate && (prefill.plate.length || prefill.plate.width)
            ? { length: prefill.plate.length || '', width: prefill.plate.width || '' }
            : null;
        var sel = prefillName
            ? { name: prefillName, enhet: prefill.enhet || '', dim: prefill.enhet || '', plate: plate }
            : null;
        var block = _createIsoCardBlock(sel);
        if (blocksC) blocksC.appendChild(block);
        _isoCardFillBlockRows(block, prefill);
    }

    _updateIsoCardBlockRemoveStates();
    _updateIsoCardTotal();
    if (typeof applyTranslations === 'function') applyTranslations();

    popup.classList.add('active');
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
    requestAnimationFrame(_anchorIsoCardTop);
}

function closeIsoCardPopup() {
    var popup = document.getElementById('iso-card-popup');
    if (popup) {
        popup.classList.remove('active', 'iso-card-popup--hidden');
        _clearPopupTopAnchor('iso-card-popup');
    }
    window._isoCardHiddenForPicker = false;
    _isoCardMaxH = 0;
    _isoCardCallback = null;
    _isoCardSelected = null;
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window.closeIsoCardPopup = closeIsoCardPopup;

function _setIsoCardMode(mode) {
    // Kun festemiddel-enhet (Stk/Eske). Isolasjon har ingen toggle lenger
    // (kapp + plate vises sammen).
    if (mode !== 'stk' && mode !== 'eske') return;
    _isoCardMode = mode;
    _isoCardEnsureActiveRow();
    _applyIsoCardMode();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window._setIsoCardMode = _setIsoCardMode;

// Produkt-velgeren er kun isolasjon; festemiddel legges som egne rader via
// "+ Legg til festemiddel". Ingen produkttype-veksling lenger (no-op,
// beholdt fordi den kalles fra flere steder).
function _applyIsoCardProductType() {}

// Låser popup-høyden til den høyeste modusen (Stk multi-rad) så bytte til
// Plate/Festemiddel ikke krymper sheeten ("hopp"). Måler bredde-modus-høyden
// uansett aktiv modus via synkron display-toggle (ingen flicker — browseren
// maler ikke midt i JS). Ingen hardkodet px — følger faktisk innhold.
// Måler høyeste modus (Stk med rader) og topp-forankrer iso-kort der.
// Topp-forankring: ratchet på høyeste sette høyde denne sesjonen. Måler
// gjeldende sheet-høyde og forankrer toppen for MAX(sett før, nå) — så bytte
// til en kortere modus IKKE flytter toppen (boksen krymper nedenfra, ingen
// hopp). Vokser innhold (flere rader / Stk) → ratchet opp.
var _isoCardMaxH = 0;
// Iso-card-popupen har INGEN modus-toggle lenger (ingen Stk/Plate-bytte),
// så topp-forankringen (som skulle hindre toggle-«hopp») er ikke lenger
// nødvendig — og den kranglet med tastatur-håndteringen (margin-top regnet
// fra full skjermhøyde dyttet Avbryt/Velg bak tastaturet). Popupen
// sentreres nå normalt med max-height:80vh + intern scroll; applyKeyboard-
// Layout eier piksel-cap + løft over tastatur, så footer alltid er synlig.
function _anchorIsoCardTop() {
    _isoCardMaxH = 0;
    _clearPopupTopAnchor('iso-card-popup');
}

function _applyIsoCardMode() {
    // Kapp + plate + festemiddel vises alltid sammen (som kappeskjema).
    // Ingen modus-veksling lenger. No-op (beholdt for kallstedene).
}

// Returnerer true hvis minst ett av input-feltene har en ikke-tom verdi.
function _anyFilled(nodeList) {
    for (var i = 0; i < nodeList.length; i++) {
        if (String(nodeList[i].value == null ? '' : nodeList[i].value).trim() !== '') return true;
    }
    return false;
}
window._anyFilled = _anyFilled;

// Prikk-indikator på Stk/Plate-toggle i Isolering-pickeren: viser hvilken
// modus som har utfylte verdier (data bevares pr. modus selv når skjult).
// Gjelder kun bredde/plate-toggle — festemiddel Stk/Eske deler samme rader
// (ingen skjult data), så den utelates bevisst.
function _updateIsoCardModeIndicators() {
    var toggle = document.getElementById('iso-card-mode-toggle-iso');
    if (!toggle) return;
    var breddeHas = _anyFilled(document.querySelectorAll('#iso-card-rows .iso-card-row input'));
    var plateHas = _anyFilled(document.querySelectorAll('#iso-card-plate-rows .isc-plate-antall'));
    var b = toggle.querySelector('.kappe-picker-mode-btn[data-mode="bredde"]');
    var p = toggle.querySelector('.kappe-picker-mode-btn[data-mode="plate"]');
    if (b) b.classList.toggle('mode-has-data', breddeHas);
    if (p) p.classList.toggle('mode-has-data', plateHas);
}
window._updateIsoCardModeIndicators = _updateIsoCardModeIndicators;

// Beregn plater pr. rad i Isolering-popupen + total. Bruker SAMME
// calcKappePlateCount() som summen/eksporten, så tallene er garantert
// konsistente. Ren visning — rører ikke data/lagring/eksport.
function _updateIsoCardPlateLines() {
    if (typeof calcKappePlateCount !== 'function') return;
    var fmt = (typeof formatKappePlateCount === 'function')
        ? formatKappePlateCount
        : function(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); };
    var total = 0, anyRow = false;
    var blocks = document.querySelectorAll('#iso-card-blocks .iso-card-block');
    blocks.forEach(function(block) {
        var sel = block._sel || {};
        var plate = sel.plate || null;
        // Kapp-rader — vis plater + velgbar kutteretning (per rad).
        block.querySelectorAll('.iso-block-kapp-rows .iso-card-row--calc').forEach(function(row) {
            var out = row.querySelector('.iso-card-row-plates');
            if (!out) return;
            var bVal = (row.querySelector('.isc-bredde') || {}).value || '';
            var lVal = (row.querySelector('.isc-lm') || {}).value || '';
            var aVal = (row.querySelector('.isc-antall') || {}).value || '';
            var sVal = (row.querySelector('.isc-sider') || {}).value || '';
            bVal = String(bVal).trim(); lVal = String(lVal).trim();
            if (!sel.name || !plate || !bVal || !lVal) { out.innerHTML = ''; return; }
            var lNum = parseLocaleNum(lVal);
            var aNum = parseLocaleNum(aVal); if (!aNum || aNum <= 0 || isNaN(aNum)) aNum = 1;
            var sNum = parseLocaleNum(sVal); if (!sNum || sNum <= 0 || isNaN(sNum)) sNum = 1;
            if (!lNum || lNum <= 0 || isNaN(lNum)) { out.innerHTML = ''; return; }
            var totalLm = Math.round(lNum * aNum * sNum * 100) / 100;
            var baseMat = {
                name: sel.name, enhet: sel.enhet || '', source: 'kappe-products',
                specMode: 'bredde', bredde: bVal, plate: plate, antall: String(totalLm)
            };
            var orient = String(row.dataset.iscOrient || '');
            var pc = calcKappePlateCount(Object.assign({}, baseMat, { kappeOrient: orient }));
            if (!(pc > 0)) { out.innerHTML = ''; return; }
            total += pc; anyRow = true;

            out.innerHTML = '';
            var ori = (typeof calcKappePlateOrientations === 'function')
                ? calcKappePlateOrientations(baseMat) : { L: null, W: null, auto: pc };
            // Vis begge retnings-valg når begge retninger er mulige — også
            // når platetallet tilfeldigvis er likt (retningen er fortsatt et
            // bevisst valg). Kun fallback til én verdi hvis bredden gjør at
            // bare én retning gir strimler.
            var hasChoice = !!(ori.L && ori.W);
            if (!hasChoice) {
                out.textContent = '≈ ' + fmt(pc) + ' plater';
                return;
            }
            // Standard (orient '') = mest svinn → marker den største chipen.
            var autoKey = (ori.L.plates >= ori.W.plates) ? 'L' : 'W';
            var selKey = (orient === 'L' || orient === 'W') ? orient : autoKey;
            [['L', ori.L], ['W', ori.W]].forEach(function(pair) {
                var key = pair[0], o = pair[1];
                var chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'iso-orient-chip' + (key === selKey ? ' iso-orient-chip--sel' : '');
                chip.textContent = o.slm + 'mm: ' + fmt(o.plates);
                chip.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    row.dataset.iscOrient = key;
                    _updateIsoCardTotal();
                });
                out.appendChild(chip);
            });
        });
        // Plate-rader (hele plater)
        block.querySelectorAll('.iso-block-plate-rows .iso-card-row--calc').forEach(function(row) {
            var out = row.querySelector('.iso-card-row-plates');
            if (!out) return;
            var pVal = String((row.querySelector('.isc-plate-antall') || {}).value || '').trim();
            if (!pVal) { out.textContent = ''; return; }
            var pc = calcKappePlateCount({ specMode: 'plate', antall: pVal });
            if (pc > 0) {
                out.textContent = '≈ ' + fmt(pc) + ' plater';
                total += pc; anyRow = true;
            } else { out.textContent = ''; }
        });
    });
    var sumEl = document.getElementById('iso-card-sum');
    if (sumEl) {
        if (anyRow) {
            sumEl.textContent = 'Sum: ' + fmt(total) + ' plater';
            sumEl.style.display = '';
        } else {
            sumEl.textContent = '';
            sumEl.style.display = 'none';
        }
    }
}

// Lm-totalen ble fjernet (tok unødig plass). Funksjonen beholdes som
// hook fordi den er bundet til mange oninput-handlere og kallsteder —
// oppdaterer Stk/Plate-prikk-indikatorene + plater pr. rad/sum.
function _updateIsoCardTotal() {
    _updateIsoCardModeIndicators();
    _updateIsoCardPlateLines();
}
window._updateIsoCardTotal = _updateIsoCardTotal;

function _openIsoCardProductSubpicker(btn) {
    _currentKappeProductBtn = btn;
    var block = _isoCardBlockOf(btn);
    // Kun isolasjon-produkter. Festemiddel velges via "+ Legg til
    // festemiddel" (egen fler-velger), som i kappeskjema.
    var products = (typeof getKappeProducts === 'function' ? getKappeProducts() : []).map(function(p) {
        return Object.assign({}, p, { source: 'kappe-products' });
    });
    if (!products.length) {
        showNotificationModal(t('kappe_settings_no_products'));
        return;
    }
    var defaultDimensions = typeof getKappeDimensions === 'function' ? getKappeDimensions() : [];
    var sel = (block && block._sel) || {};
    _hideIsoCardForPicker();
    openProductDimensionPicker({
        title: getMaterialKappeLabel(),
        products: products,
        dimensions: defaultDimensions,
        showPlate: true,
        showBredde: false,
        requireDimension: true,
        defaultFirstDimension: true,
        initialBrand: sel.name || '',
        initialDim: sel.dim || sel.enhet || '',
        plate: sel.plate || null,
        // "Nullstill" kun når et produkt er valgt → tilbakestiller produktet.
        onClear: sel.name ? function() { _clearIsoCardProduct(block); } : null,
        onConfirm: _onIsoCardProductChosen
    });
}
window._openIsoCardProductSubpicker = _openIsoCardProductSubpicker;

// Nullstill valgt isolasjon-produkt for én blokk (popupen forblir åpen;
// blokkens kapp/plate-rader beholdes).
function _clearIsoCardProduct(block) {
    if (!block) block = _isoCardBlockOf(_currentKappeProductBtn);
    if (!block) return;
    block._sel = null;
    var slot = block.querySelector('.iso-block-product-slot');
    if (slot) {
        slot.innerHTML = _kappeProductPickerHtml('', '', '')
            .replace('openKappeProductPicker(this)', '_openIsoCardProductSubpicker(this)');
    }
    if (typeof applyTranslations === 'function') applyTranslations();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window._clearIsoCardProduct = _clearIsoCardProduct;

function _onIsoCardProductChosen(selection) {
    if (!selection || !_currentKappeProductBtn) return;
    var btn = _currentKappeProductBtn;
    var block = _isoCardBlockOf(btn);
    var wrap = btn.parentElement;
    var hidden = wrap ? wrap.querySelector('.kappe-line-product') : null;
    var textSpan = btn.querySelector('.kappe-line-product-text');
    var displayName = selection.value || selection.name || '';
    if (hidden) hidden.value = displayName;
    if (textSpan) {
        textSpan.textContent = displayName;
        textSpan.classList.remove('kappe-line-product-text-placeholder');
    }
    // Plate hentes fra topp-seksjonen i undervelgeren (showPlate:true).
    var pl = document.getElementById('kappe-picker-plate-length');
    var pw = document.getElementById('kappe-picker-plate-width');
    var def = _getDefaultPlate();
    var newLen = (pl && pl.value && pl.value.trim()) || def.lengde;
    var newWid = (pw && pw.value && pw.value.trim()) || def.bredde;
    var infoWrap = btn.querySelector('.kappe-line-product-info');
    var existingHint = btn.querySelector('.kappe-line-product-plate-hint');
    var hintText = newLen + '×' + newWid;
    if (existingHint) {
        existingHint.textContent = hintText;
    } else if (infoWrap) {
        var hintEl = document.createElement('span');
        hintEl.className = 'kappe-line-product-plate-hint';
        hintEl.textContent = hintText;
        infoWrap.appendChild(hintEl);
    }
    // Produkt-velgeren er kun isolasjon (festemiddel via egen fler-velger).
    if (block) block._sel = {
        name: selection.name || displayName,
        enhet: selection.enhet || selection.dim || '',
        dim: selection.dim || selection.enhet || '',
        plate: { length: newLen, width: newWid },
        source: 'kappe-products',
        isFastener: false
    };
    _updateIsoCardTotal();
    closeKappeProductPicker();
    _anchorIsoCardTop();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}

function confirmIsoCardPopup() {
    var selections = [];
    // Hver produkt-blokk: samle BÅDE kapp- og plate-rader (som kappeskjema).
    var blocks = Array.prototype.slice.call(document.querySelectorAll('#iso-card-blocks .iso-card-block'));
    for (var bi = 0; bi < blocks.length; bi++) {
        var block = blocks[bi];
        var sel = block._sel || {};
        var hasProduct = !!sel.name;
        var blockSel = [];
        // Kapp (Bredde/LM/Antall/Sider) — hopp over tomme, krev bredde hvis utfylt.
        var rows = Array.prototype.slice.call(block.querySelectorAll('.iso-block-kapp-rows .iso-card-row'));
        for (var i = 0; i < rows.length; i++) {
            var rEl = rows[i];
            var bEl = rEl.querySelector('.isc-bredde');
            var lEl = rEl.querySelector('.isc-lm');
            var aEl = rEl.querySelector('.isc-antall');
            var sEl = rEl.querySelector('.isc-sider');
            var bVal = bEl ? String(bEl.value || '').trim() : '';
            var lVal = lEl ? String(lEl.value || '').trim() : '';
            var aVal = aEl ? String(aEl.value || '').trim() : '';
            var sVal = sEl ? String(sEl.value || '').trim() : '';
            if (!bVal && !lVal && (!aVal || aVal === '1') && (!sVal || sVal === '1')) continue;
            if (!bVal) {
                showNotificationModal('Fyll inn bredde på alle kapp-rader, eller fjern tomme.');
                return;
            }
            var lNum = parseLocaleNum(lVal);
            var ctl = '';
            if (lNum && lNum > 0 && !isNaN(lNum)) {
                var aNum = parseLocaleNum(aVal);
                var sNum = parseLocaleNum(sVal);
                if (!aNum || aNum <= 0 || isNaN(aNum)) aNum = 1;
                if (!sNum || sNum <= 0 || isNaN(sNum)) sNum = 1;
                ctl = String(Math.round(lNum * aNum * sNum * 100) / 100).replace('.', ',');
            }
            blockSel.push({
                name: sel.name, enhet: sel.enhet || '', source: 'kappe-products',
                plate: sel.plate || null, quantityUnit: 'meter', specMode: 'bredde',
                bredde: bVal, lmPerSide: lVal, antallObjekter: aVal, sider: sVal,
                computedTotalLm: ctl,
                kappeOrient: rEl.dataset.iscOrient || ''
            });
        }
        // Hele plater
        var plateRows = Array.prototype.slice.call(block.querySelectorAll('.iso-block-plate-rows .iso-card-row'));
        for (var pi = 0; pi < plateRows.length; pi++) {
            var pEl = plateRows[pi].querySelector('.isc-plate-antall');
            var pVal = pEl ? String(pEl.value || '').trim() : '';
            if (!pVal) continue;
            if (parseLocaleNum(pVal) <= 0) { showNotificationModal('Fyll inn antall plater, eller fjern tomme.'); return; }
            blockSel.push({
                name: sel.name, enhet: sel.enhet || '', source: 'kappe-products',
                plate: sel.plate || null, quantityUnit: 'stk', specMode: 'plate',
                computedTotalLm: pVal.replace('.', ',')
            });
        }
        // Kapp/plate krever valgt produkt for nettopp denne blokken.
        if (blockSel.length && !hasProduct) {
            showNotificationModal(t('kappe_settings_no_products'));
            return;
        }
        selections = selections.concat(blockSel);
    }
    // Festemiddel-rader (delt seksjon; hver bærer eget produkt/dim/enhet).
    var fastC = document.getElementById('iso-card-fastener-rows');
    var fastRows = fastC ? Array.prototype.slice.call(fastC.querySelectorAll('.iso-card-fast-row')) : [];
    for (var fi = 0; fi < fastRows.length; fi++) {
        var fRow = fastRows[fi];
        var fStkEl = fRow.querySelector('.isc-fast-stk');
        var fEskeEl = fRow.querySelector('.isc-fast-eske');
        var fStk = fStkEl ? String(fStkEl.value || '').trim() : '';
        var fEske = fEskeEl ? String(fEskeEl.value || '').trim() : '';
        if (fStk && parseLocaleNum(fStk) <= 0) { showNotificationModal('Fyll inn gyldig antall på festemiddel, eller fjern tomme.'); return; }
        if (fEske && parseLocaleNum(fEske) <= 0) { showNotificationModal('Fyll inn gyldig antall på festemiddel, eller fjern tomme.'); return; }
        if (!fStk && !fEske) continue;
        var fBase = {
            name: fRow.dataset.fname || '',
            enhet: fRow.dataset.fenhet || '',
            source: fRow.dataset.fsource || 'kappe-fastener',
            plate: null
        };
        if (fStk) selections.push(Object.assign({}, fBase, {
            specMode: 'stk', quantityUnit: 'stk', antall: fStk.replace('.', ',')
        }));
        if (fEske) selections.push(Object.assign({}, fBase, {
            specMode: 'eske', quantityUnit: 'eske', antall: fEske.replace('.', ',')
        }));
    }
    if (!selections.length) {
        showNotificationModal('Fyll inn kapp, plate eller festemiddel.');
        return;
    }
    var cb = _isoCardCallback;
    closeIsoCardPopup();
    if (cb) selections.forEach(function(s) { cb(s); });
}
window.confirmIsoCardPopup = confirmIsoCardPopup;
window.openIsoCardPopup = openIsoCardPopup;

// ─── Timer-oversikt ─────────────────────────────────────────────────────────
// Lesbar oversikt over timer PER BESTILLING innenfor DENNE ordreseddelen.
// Hver bestilling kan ha timer på flere dager — derfor lister vi bestillinger
// (ikke dager: én dag kan ha mange bestillinger), viser dag-fordelingen
// kompakt + sum, og lar deg åpne bestillingens egen Arbeidstid-popup for å
// redigere (den håndterer fler-dagers korrekt). Ingen dato-/uke-logikk,
// ingenting på tvers av ordresedler.
var TIMER_DAY_KEYS = ['ma', 'ti', 'on', 'to', 'fr', 'lo', 'so'];

function _orderTimerObj(card) {
    try { return JSON.parse(card.getAttribute('data-timer') || '{}') || {}; }
    catch (e) { return {}; }
}
function _fmtHours(n) {
    if (!n) return '0';
    return (Math.round(n * 100) / 100).toString().replace('.', ',');
}
// Summer timer per ukedag (+ Annet) på tvers av alle bestillinger i
// ordreseddelen. _generelt har forrang over legacy _total.
function _weekTimerTotals() {
    var tot = { _generelt: 0, total: 0 };
    TIMER_DAY_KEYS.forEach(function(k) { tot[k] = 0; });
    document.querySelectorAll('#mobile-orders .mobile-order-card').forEach(function(card) {
        var tm = _orderTimerObj(card);
        TIMER_DAY_KEYS.forEach(function(k) {
            var n = parseLocaleNum(tm[k]);
            if (!isNaN(n)) tot[k] += n;
        });
        var g = (tm._generelt != null && String(tm._generelt).trim() !== '') ? tm._generelt
            : ((tm._total != null && String(tm._total).trim() !== '') ? tm._total : null);
        if (g != null) { var gn = parseLocaleNum(g); if (!isNaN(gn)) tot._generelt += gn; }
    });
    tot.total = TIMER_DAY_KEYS.reduce(function(a, k) { return a + tot[k]; }, 0) + tot._generelt;
    return tot;
}

function updateTimerChip() {
    var chip = document.getElementById('timer-overview-chip');
    if (!chip) return;
    var val = chip.querySelector('.timer-chip-value');
    if (val) val.textContent = _fmtHours(_weekTimerTotals().total) + ' t';
}
window.updateTimerChip = updateTimerChip;

// Sum timer for ÉN bestilling (alle dager + Annet).
function _orderHoursSum(tm) {
    var s = 0;
    TIMER_DAY_KEYS.forEach(function(k) {
        var n = parseLocaleNum(tm[k]);
        if (!isNaN(n)) s += n;
    });
    var g = (tm._generelt != null && String(tm._generelt).trim() !== '') ? tm._generelt
        : ((tm._total != null && String(tm._total).trim() !== '') ? tm._total : null);
    if (g != null) { var gn = parseLocaleNum(g); if (!isNaN(gn)) s += gn; }
    return s;
}
function _orderDayPlansObj(card) {
    // Backward-compat: gamle lesere forventer {[dag]: planStr}. Etasjer er nå
    // bestilling-nivå; vi gjenskaper per-dag-formatet ved å gi alle dager med
    // timer hele plan-listen. Foretrekker data-plans, faller tilbake til
    // legacy data-day-plans.
    if (!card) return {};
    var plans = [];
    try { plans = JSON.parse(card.getAttribute('data-plans') || '[]') || []; } catch (e) {}
    if (!plans.length) {
        try { return JSON.parse(card.getAttribute('data-day-plans') || '{}') || {}; }
        catch (e) { return {}; }
    }
    var planStr = plans.join(', ');
    var out = {};
    try {
        var tm = JSON.parse(card.getAttribute('data-timer') || '{}') || {};
        Object.keys(tm).forEach(function(d) { out[d] = planStr; });
    } catch (e) {}
    return out;
}
// Dag-fordeling for en bestilling. Etasjer er nå BESTILLING-nivå (én flat
// liste), ikke per-dag — derfor returnerer dette dag-deler (timer per dag)
// + én ekstra «chip» for Etasjer på slutten hvis bestillingen har plans.
function _orderDayBreakdown(tm, plans) {
    var shortMap = (typeof dagShortMap === 'object' && dagShortMap) ? dagShortMap : {
        ma: 'Ma', ti: 'Ti', on: 'On', to: 'To', fr: 'Fr', lo: 'Lø', so: 'Sø'
    };
    function _hasVal(v) { return v != null && String(v).trim() !== ''; }
    var parts = [];
    TIMER_DAY_KEYS.forEach(function(k) {
        if (_hasVal(tm[k])) {
            parts.push({
                day: shortMap[k] || k,
                hours: String(tm[k]).replace('.', ',') + 't',
                plan: ''
            });
        }
    });
    var g = _hasVal(tm._generelt) ? tm._generelt : (_hasVal(tm._total) ? tm._total : '');
    if (_hasVal(g)) {
        parts.push({
            day: t('timer_overview_other'),
            hours: String(g).replace('.', ',') + 't',
            plan: ''
        });
    }
    if (plans && plans.length) {
        // Samme stil som dag-delene: fet prefix + verdier inline.
        parts.push({
            isPlans: true,
            day: 'Etasje',
            hours: '',
            plan: plans.join(', ')
        });
    }
    return parts;
}
// Etikett som ordrekort-tittelen: "N. <beskrivelse>" når Beskrivelse er
// fylt ut (både nummer OG innhold), ellers bare "Bestilling N".
function _orderRowLabel(card, idx) {
    var d = card.querySelector('.mobile-order-desc');
    var txt = d ? String(d.value || '').trim() : '';
    if (txt) {
        // Slå sammen linjeskift/whitespace til mellomrom — CSS klipper til
        // maks 2 linjer (kompakt + skannbart, men nok kontekst).
        txt = txt.replace(/\s+/g, ' ').trim();
        return (idx + 1) + '. ' + txt;
    }
    return t('order_title') + ' ' + (idx + 1);
}

function openTimerOverview() {
    var modal = document.getElementById('timer-overview-modal');
    if (!modal) return;
    var list = document.getElementById('timer-overview-list');
    if (!list) return;
    list.innerHTML = '';
    var cards = document.querySelectorAll('#mobile-orders .mobile-order-card');

    if (!cards.length) {
        var empty = document.createElement('div');
        empty.className = 'timer-overview-empty';
        empty.textContent = t('timer_overview_empty');
        list.appendChild(empty);
    }

    var total = 0;
    cards.forEach(function(card, idx) {
        var tm = _orderTimerObj(card);
        var plans = (typeof _getCardPlans === 'function') ? _getCardPlans(card) : [];
        var sum = _orderHoursSum(tm);
        total += sum;
        var breakdown = _orderDayBreakdown(tm, plans);

        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'timer-overview-row timer-overview-row--order';

        var main = document.createElement('div');
        main.className = 'timer-ov-main';
        var label = document.createElement('span');
        label.className = 'timer-overview-label';
        label.textContent = _orderRowLabel(card, idx);
        var value = document.createElement('span');
        value.className = 'timer-overview-value';
        value.textContent = sum > 0 ? _fmtHours(sum) + ' t' : '–';
        if (!(sum > 0)) value.classList.add('timer-overview-value--empty');
        var chev = document.createElement('span');
        chev.className = 'fakturaadresse-chevron';
        chev.textContent = '›';
        main.appendChild(label);
        main.appendChild(value);
        main.appendChild(chev);
        row.appendChild(main);

        var sub = document.createElement('div');
        sub.className = 'timer-ov-sub';
        if (!breakdown.length) {
            sub.classList.add('timer-ov-sub--empty');
            sub.textContent = t('timer_overview_no_hours');
        } else {
            breakdown.forEach(function(p) {
                // Hver del er én ikke-brytbar «chip» (wrapper som helhet til
                // neste linje). Etasjer er bestilling-nivå og rendres som
                // egen chip på slutten (isPlans).
                var part = document.createElement('span');
                part.className = 'timer-ov-part' + (p.isPlans ? ' timer-ov-part-plans' : '');
                var d = document.createElement('b');
                d.className = 'timer-ov-day';
                d.textContent = p.day;
                part.appendChild(d);
                if (p.hours) part.appendChild(document.createTextNode(' ' + p.hours));
                if (p.plan) part.appendChild(document.createTextNode(' ' + p.plan));
                sub.appendChild(part);
            });
        }
        row.appendChild(sub);

        // Rediger = åpne bestillingens egen Arbeidstid-popup (håndterer
        // fler-dagers korrekt). Lukk oversikten så de ikke stables, men sett
        // retur-flagg så closeDagTimerModal åpner oversikten igjen (oppdatert)
        // ved både OK og Avbryt — bruker blir værende i flyten.
        row.addEventListener('click', function() {
            window._timerOverviewReturn = true;
            closeTimerOverview();
            if (typeof openDagTimerModal === 'function') openDagTimerModal(card);
        });

        list.appendChild(row);
    });

    var totalEl = document.getElementById('timer-overview-total-value');
    if (totalEl) totalEl.textContent = _fmtHours(total) + ' t';

    modal.classList.add('active');
    if (typeof applyTranslations === 'function') applyTranslations();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window.openTimerOverview = openTimerOverview;

function closeTimerOverview() {
    var modal = document.getElementById('timer-overview-modal');
    if (modal) modal.classList.remove('active');
    updateTimerChip();
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window.closeTimerOverview = closeTimerOverview;

function _createKappeKappRow(kappData) {
    var d = kappData || {};
    var row = document.createElement('div');
    row.className = 'kappe-kapp-row';
    row.innerHTML =
        '<div class="kappe-quad-row">' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_bredde">Bredde</label>' +
                '<input type="text" class="kappe-line-bredde" inputmode="decimal" pattern="[0-9,.]*" placeholder="mm" value="' + escapeHtml(d.bredde || '') + '">' +
            '</div>' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_lopemeter">LM</label>' +
                '<input type="text" class="kappe-line-lopemeter" inputmode="decimal" pattern="[0-9,.]*" value="' + escapeHtml(d.lopemeter || d['løpemeter'] || '') + '">' +
            '</div>' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_antall">Antall</label>' +
                '<input type="text" class="kappe-line-antall" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(d.antall || '') + '">' +
            '</div>' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_antall_sider">Sider</label>' +
                '<input type="text" class="kappe-line-antall-sider" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(d.antallSider || '') + '">' +
            '</div>' +
        '</div>' +
        '<button type="button" class="kappe-kapp-remove-btn" onclick="removeKappeKappRow(this)" title="Fjern rad">' + deleteIcon + '</button>';
    row.querySelector('.kappe-line-bredde').addEventListener('input', renumberKappeLines);
    return row;
}

function addKappeKappRow(btn) {
    var card = btn.closest('.kappe-line-card');
    var container = card.querySelector('.kappe-kapp-rows');
    var row = _createKappeKappRow({});
    container.appendChild(row);
    _updateKappeKappRemoveStates(card);
    renumberKappeLines();
}

function removeKappeKappRow(btn) {
    var row = btn.closest('.kappe-kapp-row');
    var card = row.closest('.kappe-line-card');
    // Kapp-seksjonen er valgfri — tillat å fjerne helt ned til 0 rader.
    row.remove();
    _updateKappeKappRemoveStates(card);
    renumberKappeLines();
}

function _updateKappeKappRemoveStates(card) {
    // Valgfri seksjon: alltid lov å fjerne en kapp-rad (0 er gyldig).
    card.querySelectorAll('.kappe-kapp-remove-btn').forEach(function(b) {
        b.disabled = false;
    });
}

// Plate-modus multi-rad (speiler kapp-rad-mønsteret). Egne klasser så
// remove-states ikke krysser med Stk-radene.
function _createKappePlateRow(d) {
    d = d || {};
    var row = document.createElement('div');
    row.className = 'kappe-plate-row';
    row.innerHTML =
        '<div class="kappe-quad-row">' +
            '<div class="mobile-field field-required"><label data-i18n="iso_plate_count">Antall plater</label>' +
                '<input type="text" class="kappe-line-plate-antall" inputmode="decimal" pattern="[0-9,.]*" value="' + escapeHtml(d.antall || '') + '"></div>' +
        '</div>' +
        '<button type="button" class="kappe-plate-remove-btn" onclick="removeKappePlateRow(this)" title="Fjern rad">' + deleteIcon + '</button>';
    return row;
}
function addKappePlateRow(btn) {
    var card = btn.closest('.kappe-line-card');
    var container = card.querySelector('.kappe-plate-rows');
    container.appendChild(_createKappePlateRow({}));
    _updateKappePlateRemoveStates(card);
    if (typeof applyTranslations === 'function') applyTranslations();
    renumberKappeLines();
}
window.addKappePlateRow = addKappePlateRow;
function removeKappePlateRow(btn) {
    var row = btn.closest('.kappe-plate-row');
    var card = row.closest('.kappe-line-card');
    // Plate-seksjonen er valgfri — tillat å fjerne helt ned til 0 rader.
    row.remove();
    _updateKappePlateRemoveStates(card);
    renumberKappeLines();
}
window.removeKappePlateRow = removeKappePlateRow;
function _updateKappePlateRemoveStates(card) {
    // Valgfri seksjon: alltid lov å fjerne en plate-rad (0 er gyldig).
    card.querySelectorAll('.kappe-plate-remove-btn').forEach(function(b) {
        b.disabled = false;
    });
}

function _getKappeLineKappData(card) {
    var kapp = [];
    card.querySelectorAll('.kappe-kapp-row').forEach(function(row) {
        kapp.push({
            bredde: (row.querySelector('.kappe-line-bredde') || {}).value || '',
            lopemeter: (row.querySelector('.kappe-line-lopemeter') || {}).value || '',
            antall: (row.querySelector('.kappe-line-antall') || {}).value || '1',
            antallSider: (row.querySelector('.kappe-line-antall-sider') || {}).value || ''
        });
    });
    return kapp;
}

function _getKappeLinePlateData(card) {
    var rader = [];
    card.querySelectorAll('.kappe-plate-rows .kappe-plate-row').forEach(function(row) {
        var v = (row.querySelector('.kappe-line-plate-antall') || {}).value || '';
        if (v) rader.push({ antall: v });
    });
    return rader;
}

// En kappe-linje er ENTEN en kapp-linje (Stk: bredde/LM/antall/sider, WN630)
// ELLER en plate-linje (hele plater, ingen kapping). Ulike formål → egen
// linje med egen merknad. Ingen toggle. Typen velges ved opprettelse og
// utledes fra lagrede data ved lasting (data.type, ev. legacy specMode).
function createKappeLineCard(lineData, expanded) {
    var data = lineData || {};

    // Ingen default-rad: rader legges til on-demand via "+ Legg til ...".
    // Backward compat: old format had bredde/lopemeter/antallSider directly.
    var kappList = (data.kapp && data.kapp.length)
        ? data.kapp
        : ((data.bredde || data.lopemeter || data.antallSider)
            ? [{ bredde: data.bredde || '', lopemeter: data.lopemeter || data['løpemeter'] || '', antallSider: data.antallSider || '' }]
            : []);
    // Plate-rader: fra plateRader[], eller migrer fra gammel enkelt plateAntall.
    // Tomt som standard — plate-seksjonen er valgfri (bruker trykker
    // "+ Legg til plate" ved behov). Ingen tom default-rad.
    var plateList = (data.plateRader && data.plateRader.length)
        ? data.plateRader
        : (data.plateAntall ? [{ antall: data.plateAntall }] : []);

    // Festemiddel er en EGEN seksjon (ikke pr. kappelinje) — kappelinjer er
    // kun isolasjon (kapp/plate). Ingen default-rad: rader on-demand.

    // Plate-dimensjoner: fra lagrede data hvis tilgjengelig, ellers global default.
    // Skjulte inputs holder verdiene; bruker editerer via produkt-popup.
    var def = _getDefaultPlate();
    var initialPlate = {
        lengde: data.plateLengde || def.lengde,
        bredde: data.plateBredde || def.bredde
    };

    var card = document.createElement('div');
    card.className = 'kappe-line-card mobile-order-card';

    // UI avhenger av produkt. Før produkt er valgt: vis kun en hint, ingen
    // rader/knapper. Etter valg: kapp/plate-knapper (ingen rader by default).
    var hasProduct = !!(data.produkt && String(data.produkt).trim());
    var hintDisp = hasProduct ? ' style="display:none"' : '';
    var isoDisp = hasProduct ? '' : ' style="display:none"';
    var sectionHtml =
        '<div class="kappe-line-pick-hint" data-i18n="kappe_pick_product_hint"' + hintDisp + '>' + t('kappe_pick_product_hint') + '</div>' +
        '<div class="kappe-iso-sections"' + isoDisp + '>' +
            '<div class="kappe-kapp-rows"></div>' +
            '<div class="kappe-plate-rows"></div>' +
            '<div class="kappe-add-row-buttons">' +
                '<button type="button" class="kappe-add-kapp-btn kappe-add-kapp-stk" onclick="addKappeKappRow(this)">+ ' + t('kappe_add_kapp') + '</button>' +
                '<button type="button" class="kappe-add-kapp-btn kappe-add-plate-btn" onclick="addKappePlateRow(this)">+ ' + t('kappe_add_plate') + '</button>' +
            '</div>' +
        '</div>';

    card.innerHTML =
        '<div class="mobile-order-header kappe-line-header" onclick="toggleKappeLine(this)">' +
            '<span class="mobile-order-arrow">' + (expanded ? '&#9650;' : '&#9660;') + '</span>' +
            '<span class="kappe-line-title"></span>' +
            '<button type="button" class="mobile-order-header-delete" onclick="event.stopPropagation(); removeKappeLine(this)">' + deleteIcon + '</button>' +
        '</div>' +
        '<div class="mobile-order-body-wrap' + (expanded ? ' expanded' : '') + '">' +
        '<div class="mobile-order-body kappe-line-body">' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_produkt">Produkt</label>' +
                _kappeProductPickerHtml(data.produkt || '', initialPlate.lengde, initialPlate.bredde) +
            '</div>' +
            '<input type="hidden" class="kappe-line-plate-length" value="' + escapeHtml(initialPlate.lengde) + '">' +
            '<input type="hidden" class="kappe-line-plate-width" value="' + escapeHtml(initialPlate.bredde) + '">' +
            sectionHtml +
            '<div class="mobile-field">' +
                '<label data-i18n="kappe_col_merknad">' + t('kappe_col_merknad') + '</label>' +
                '<textarea class="kappe-line-merknad" rows="1" autocapitalize="sentences">' + escapeHtml(data.merknad || '') + '</textarea>' +
            '</div>' +
        '</div>' +
        '</div>';

    var kappContainer = card.querySelector('.kappe-kapp-rows');
    kappList.forEach(function(k) {
        kappContainer.appendChild(_createKappeKappRow(k));
    });
    _updateKappeKappRemoveStates(card);

    var plateContainer = card.querySelector('.kappe-plate-rows');
    plateList.forEach(function(p) {
        plateContainer.appendChild(_createKappePlateRow(p));
    });
    _updateKappePlateRemoveStates(card);

    card.dataset.specMode = 'bredde';
    card.querySelector('.kappe-line-product').addEventListener('change', renumberKappeLines);

    var merknadEl = card.querySelector('.kappe-line-merknad');
    if (merknadEl) {
        merknadEl.addEventListener('focus', function() {
            // Re-kalkuler høyde ved focus — fanger opp stale inline height.
            // Kompenserer for intern scroll-redistribusjon så tappet linje
            // står stille (se _focusResizeWithoutShift i script.js).
            _focusResizeWithoutShift(this);
        });
        merknadEl.addEventListener('input', function() {
            _autoResizeMerknadAndScroll(this);
        });
        merknadEl.addEventListener('blur', function() {
            autoResizeTextarea(this);
        });
        requestAnimationFrame(function() {
            _autoResizeMerknadAndScroll(merknadEl);
        });
    }

    return card;
}

function addKappeLine() {
    var container = document.getElementById('kappe-lines');
    var existingCards = container.querySelectorAll('.kappe-line-card');
    // Husk produkt og plate fra siste linje
    var inheritData = {};
    if (existingCards.length > 0) {
        var lastCard = existingCards[existingCards.length - 1];
        var lastProduct = lastCard.querySelector('.kappe-line-product');
        var lastPlateLen = lastCard.querySelector('.kappe-line-plate-length');
        var lastPlateWid = lastCard.querySelector('.kappe-line-plate-width');
        if (lastProduct && lastProduct.value) inheritData.produkt = lastProduct.value;
        if (lastPlateLen && lastPlateLen.value) inheritData.plateLengde = lastPlateLen.value;
        if (lastPlateWid && lastPlateWid.value) inheritData.plateBredde = lastPlateWid.value;
    }
    existingCards.forEach(function(card) {
        var wrap = card.querySelector('.mobile-order-body-wrap');
        if (wrap && wrap.classList.contains('expanded')) {
            wrap.classList.remove('expanded');
            card.querySelector('.mobile-order-arrow').innerHTML = '&#9660;';
        }
    });
    var card = createKappeLineCard(inheritData, true);
    container.appendChild(card);
    updateKappeDeleteStates();
    renumberKappeLines();
    updateKappeRequiredIndicators();
    sessionStorage.setItem('firesafe_kappe_current', JSON.stringify(getKappeFormData()));
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.addKappeLine = addKappeLine;

function removeKappeLine(btn) {
    var card = btn.closest('.kappe-line-card');
    var container = document.getElementById('kappe-lines');
    if (container.querySelectorAll('.kappe-line-card').length <= 1) return;
    showConfirmModal(t('kappe_line_delete_confirm'), function() {
        card.remove();
        updateKappeDeleteStates();
        renumberKappeLines();
        sessionStorage.setItem('firesafe_kappe_current', JSON.stringify(getKappeFormData()));
    }, t('btn_remove'), '#e74c3c');
}

function toggleKappeLine(headerEl) {
    if (document.activeElement) document.activeElement.blur();
    var card = headerEl.closest('.kappe-line-card');
    var wrap = card.querySelector('.mobile-order-body-wrap');
    var arrow = headerEl.querySelector('.mobile-order-arrow');
    if (!wrap.classList.contains('expanded')) {
        wrap.classList.add('expanded');
        arrow.innerHTML = '&#9650;';
        requestAnimationFrame(function() { scrollCardToTop(card, true); });
    } else {
        wrap.classList.remove('expanded');
        arrow.innerHTML = '&#9660;';
    }
}

function renumberKappeLines() {
    document.querySelectorAll('#kappe-lines .kappe-line-card').forEach(function(card, idx) {
        var prod = card.querySelector('.kappe-line-product');
        var plateLen = card.querySelector('.kappe-line-plate-length');
        var plateWid = card.querySelector('.kappe-line-plate-width');
        // Begge modi kan ha data samtidig — vis begge i tittelen, uavhengig
        // av hvilken toggle-fane som er aktiv.
        var bits = ['#' + (idx + 1)];
        if (prod && prod.value) bits.push(prod.value);
        // Plate-dim er kun relevant for isolasjon MED valgt produkt.
        if (prod && prod.value && plateLen && plateWid && plateLen.value && plateWid.value) {
            bits.push(plateLen.value + '×' + plateWid.value);
        }
        var kappWithData = 0;
        card.querySelectorAll('.kappe-kapp-rows .kappe-kapp-row').forEach(function(row) {
            var b = row.querySelector('.kappe-line-bredde');
            var lm = row.querySelector('.kappe-line-lopemeter');
            if ((b && String(b.value || '').trim() !== '') ||
                (lm && String(lm.value || '').trim() !== '')) kappWithData++;
        });
        if (kappWithData > 0) bits.push(kappWithData + ' kapp');
        var pSum = 0;
        card.querySelectorAll('.kappe-plate-rows .kappe-line-plate-antall').forEach(function(inp) {
            var v = parseLocaleNum(inp.value);
            if (!isNaN(v) && v > 0) pSum += v;
        });
        if (pSum > 0) bits.push((Math.round(pSum * 100) / 100) + ' hele plater');
        card.querySelector('.kappe-line-title').textContent = bits.join(' · ');
    });
}

function updateKappeDeleteStates() {
    var cards = document.querySelectorAll('#kappe-lines .kappe-line-card');
    var delBtns = document.querySelectorAll('#kappe-lines .mobile-order-header-delete');
    delBtns.forEach(function(btn) { btn.disabled = cards.length <= 1; });
}

// Samme mønster som kapp-rader (.kappe-quad-row + .mobile-field label over
// felt) for konsistent stil. Ingen placeholder inni input.
function _kappeStiftRowHtml(size, productName, stkVal, eskeVal) {
    productName = productName || MATERIAL_STIFT_LAUNCHER;
    return '<div class="kappe-stift-row" data-row-size="' + escapeHtml(size) + '" data-product="' + escapeHtml(productName) + '">' +
        '<span class="kappe-stift-label">' + escapeHtml(productName + ' ' + _formatDimMm(size)) + '</span>' +
        '<div class="kappe-quad-row kappe-stift-fields">' +
            '<div class="mobile-field"><label>' + escapeHtml(t('kappe_unit_stk')) + '</label>' +
                '<input type="text" class="kappe-stift-stk" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(stkVal || '') + '"></div>' +
            '<div class="mobile-field"><label>' + escapeHtml(t('kappe_unit_eske')) + '</label>' +
                '<input type="text" class="kappe-stift-eske" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(eskeVal || '') + '"></div>' +
        '</div>' +
        '<button type="button" class="kappe-kapp-remove-btn" onclick="removeKappeStiftRow(this)" title="Fjern rad">' + deleteIcon + '</button>' +
    '</div>';
}

// Bakoverkompat: eldre lagrede festemidler hadde {antall, enhetType}.
function _stiftItemVals(s) {
    if (s.stk != null || s.eske != null) return { stk: s.stk || '', eske: s.eske || '' };
    var u = s.enhetType || s.unit || s.quantityUnit || '';
    if (String(u).toLowerCase() === 'eske') return { stk: '', eske: s.antall || '' };
    return { stk: s.antall || '', eske: '' };
}

function renderKappeStiftRows(existing) {
    var container = document.getElementById('kappe-stift');
    if (!container) return;
    var html = '';
    var rows = (existing && existing.length) ? existing : [];
    rows.forEach(function(s) {
        var size = s.storrelse || s['størrelse'] || s.enhet;
        if (!size) return;
        var v = _stiftItemVals(s);
        html += _kappeStiftRowHtml(size, s.produkt || s.product || MATERIAL_STIFT_LAUNCHER, v.stk, v.eske);
    });
    container.innerHTML = html;
    _updateKappeStiftAddBtnState();
}

function _updateKappeStiftAddBtnState() {
    var btn = document.getElementById('kappe-stift-add');
    if (!btn) return;
    btn.disabled = !getKappeFastenerProducts().length || !getKappeFastenerDimensions().length;
}

function openKappeStiftPicker() {
    var fasteners = getKappeFastenerProducts();
    if (!fasteners.length) {
        showNotificationModal(t('kappe_settings_no_products'));
        return;
    }
    // Forhåndsvelg det som allerede ligger i Festemidler-lista.
    var existingContainer = document.getElementById('kappe-stift');
    var initialPairs = [];
    if (existingContainer) {
        existingContainer.querySelectorAll('.kappe-stift-row').forEach(function(row) {
            initialPairs.push({
                name: row.getAttribute('data-product') || MATERIAL_STIFT_LAUNCHER,
                dim: row.getAttribute('data-row-size') || ''
            });
        });
    }
    var opened = openProductDimensionPicker({
        title: getKappeFastenerLabel(),
        products: fasteners,
        dimensions: getKappeFastenerDimensions(),
        showPlate: false,
        requireDimension: true,
        multiDimension: true,
        initialPairs: initialPairs,
        // Synk lista til valgte par: behold antall (stk/eske) på eksisterende
        // rader, legg til nye, fjern fravalgte.
        onConfirmMulti: function(pairs) {
            var container = document.getElementById('kappe-stift');
            if (!container) return;
            // Snapshot eksisterende verdier pr. produkt|størrelse.
            var prev = {};
            container.querySelectorAll('.kappe-stift-row').forEach(function(row) {
                var key = (row.getAttribute('data-product') || '') + '||' + (row.getAttribute('data-row-size') || '');
                prev[key] = {
                    stk: (row.querySelector('.kappe-stift-stk') || {}).value || '',
                    eske: (row.querySelector('.kappe-stift-eske') || {}).value || ''
                };
            });
            var html = '';
            pairs.forEach(function(p) {
                var size = p.dim || p.enhet || '';
                if (!size) return;
                var pv = prev[p.name + '||' + size] || { stk: '', eske: '' };
                html += _kappeStiftRowHtml(size, p.name, pv.stk, pv.eske);
            });
            container.innerHTML = html;
            _updateKappeStiftAddBtnState();
            requestAnimationFrame(function() {
                var rows = container.querySelectorAll('.kappe-stift-row');
                var row = rows[rows.length - 1];
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }
    });
    if (!opened) _updateKappeStiftAddBtnState();
}

function removeKappeStiftRow(btn) {
    var row = btn.closest('.kappe-stift-row');
    if (row) row.remove();
    _updateKappeStiftAddBtnState();
}

function getKappeFormData() {
    var lines = [];
    document.querySelectorAll('#kappe-lines .kappe-line-card').forEach(function(card) {
        // Festemiddel-linje: lagre fastUnit + fast-rader. Isolasjon-linje:
        // BÅDE kapp- og plate-seksjon (tomme rader filtreres ved eksport).
        // specMode beholdes for bakoverkompat med eldre eksport-/lese-kode.
        var base = {
            produkt: (card.querySelector('.kappe-line-product') || {}).value || '',
            plateLengde: (card.querySelector('.kappe-line-plate-length') || {}).value || '1200',
            plateBredde: (card.querySelector('.kappe-line-plate-width') || {}).value || '1000',
            specMode: 'bredde',
            merknad: (card.querySelector('.kappe-line-merknad') || {}).value || ''
        };
        base.plateRader = _getKappeLinePlateData(card);
        base.kapp = _getKappeLineKappData(card);
        lines.push(base);
    });
    var stift = [];
    document.querySelectorAll('#kappe-stift .kappe-stift-row').forEach(function(row) {
        var stkV = ((row.querySelector('.kappe-stift-stk') || {}).value || '').trim();
        var eskeV = ((row.querySelector('.kappe-stift-eske') || {}).value || '').trim();
        if (!stkV && !eskeV) return;
        stift.push({
            produkt: row.getAttribute('data-product') || MATERIAL_STIFT_LAUNCHER,
            storrelse: row.getAttribute('data-row-size'),
            stk: stkV,
            eske: eskeV
        });
    });
    return {
        type: 'kappe',
        dato: document.getElementById('kappe-dato').value,
        onsketLeveringsdato: document.getElementById('kappe-onsket-leveringsdato').value,
        avdeling: document.getElementById('kappe-avdeling').value,
        bestiller: document.getElementById('kappe-bestiller').value,
        prosjektnr: document.getElementById('kappe-prosjektnr').value,
        prosjektnavn: document.getElementById('kappe-prosjektnavn').value,
        leveringsadresse: {
            mottaker: document.getElementById('kappe-mottaker').value,
            veiadresse: document.getElementById('kappe-veiadresse').value,
            postnr: document.getElementById('kappe-postnr').value,
            poststed: document.getElementById('kappe-poststed').value,
            kontakt: document.getElementById('kappe-kontakt').value,
            tlf: document.getElementById('kappe-tlf').value
        },
        pallemerking: document.getElementById('kappe-pallemerking').value,
        lines: lines,
        stift: stift,
        fasteners: stift,
        savedAt: new Date().toISOString()
    };
}

function getKappeFormDataSnapshot() {
    var d = getKappeFormData();
    delete d.savedAt;
    return JSON.stringify(d);
}

function setKappeFormData(data) {
    if (!data) return;
    document.getElementById('kappe-dato').value = data.dato || _kappeFormatDateNO(_kappeTodayISO());
    document.getElementById('kappe-onsket-leveringsdato').value = _kappeFormatDateNO(data.onsketLeveringsdato) || '';
    document.getElementById('kappe-avdeling').value = data.avdeling || '';
    document.getElementById('kappe-bestiller').value = stripEtternavn(data.bestiller);
    document.getElementById('kappe-prosjektnr').value = data.prosjektnr || '';
    document.getElementById('kappe-prosjektnavn').value = data.prosjektnavn || '';
    var lev = data.leveringsadresse || {};
    document.getElementById('kappe-mottaker').value = lev.mottaker || '';
    document.getElementById('kappe-veiadresse').value = lev.veiadresse || '';
    document.getElementById('kappe-postnr').value = lev.postnr || '';
    document.getElementById('kappe-poststed').value = lev.poststed || '';
    document.getElementById('kappe-kontakt').value = lev.kontakt || '';
    document.getElementById('kappe-tlf').value = lev.tlf || '';
    document.getElementById('kappe-pallemerking').value = data.pallemerking || '';

    var container = document.getElementById('kappe-lines');
    container.innerHTML = '';
    var list = (data.lines && data.lines.length) ? data.lines : [{}];
    // Ett kort per lagret linje. Hvert kort har både kapp- og plate-seksjon;
    // eldre skjemaer (separate kapp/plate-linjer) lastes uendret — kortet
    // bygger begge seksjoner, den ubrukte forblir tom.
    list.forEach(function(line) { container.appendChild(createKappeLineCard(line, list.length === 1)); });
    renumberKappeLines();
    updateKappeDeleteStates();
    renderKappeStiftRows(data.fasteners || data.stift || []);
}

function hasUnsavedKappeChanges() {
    var current = getKappeFormDataSnapshot();
    if (_kappeLastSavedData === null) {
        // Check if any meaningful data was entered
        try {
            var d = JSON.parse(current);
            if (d.prosjektnr || d.prosjektnavn || d.avdeling || d.bestiller) return true;
            if ((d.lines || []).some(function(l) { return l.produkt || l.bredde || l.lopemeter || l.antallSider; })) return true;
            if ((d.stift || []).some(function(s) { return s.antall; })) return true;
        } catch (e) {}
        return false;
    }
    return current !== _kappeLastSavedData;
}

var KAPPE_FIELD_IDS = {
    onsketLeveringsdato: 'kappe-onsket-leveringsdato',
    avdeling:            'kappe-avdeling',
    bestiller:           'kappe-bestiller',
    prosjektnr:          'kappe-prosjektnr',
    prosjektnavn:        'kappe-prosjektnavn',
    pallemerking:        'kappe-pallemerking',
    mottaker:            'kappe-mottaker',
    veiadresse:          'kappe-veiadresse',
    postnr:              'kappe-postnr',
    poststed:            'kappe-poststed',
    kontakt:             'kappe-kontakt',
    tlf:                 'kappe-tlf'
};
var KAPPE_FIELD_LABELS = {
    onsketLeveringsdato: 'kappe_label_onsket_leveringsdato',
    avdeling:            'label_avdeling',
    bestiller:           'kappe_label_bestiller',
    prosjektnr:          'label_prosjektnr',
    prosjektnavn:        'label_prosjektnavn',
    pallemerking:        'kappe_label_pallemerking',
    mottaker:            'kappe_label_mottaker',
    veiadresse:          'kappe_label_veiadresse',
    postnr:              'placeholder_postnr',
    poststed:            'placeholder_poststed',
    kontakt:             'kappe_label_kontakt',
    tlf:                 'kappe_label_tlf'
};

function _getKappeRequired() {
    var settings = cachedRequiredSettings || getDefaultRequiredSettings();
    return settings.kappe || getDefaultRequiredSettings().kappe;
}

function updateKappeRequiredIndicators() {
    var req = _getKappeRequired();
    // Tekst-felter
    Object.keys(KAPPE_FIELD_IDS).forEach(function(key) {
        var el = document.getElementById(KAPPE_FIELD_IDS[key]);
        if (!el) return;
        var field = el.closest('.mobile-field');
        if (!field) return;
        if (req[key] === true) field.classList.add('field-required');
        else field.classList.remove('field-required');
    });
    // Produkt-seksjon
    var prodSection = document.querySelector('.mobile-section-title[data-i18n="kappe_section_products"]');
    if (prodSection) {
        if (req.produkter === true) prodSection.classList.add('field-required');
        else prodSection.classList.remove('field-required');
    }
    // Stift-seksjon
    var stiftSection = document.querySelector('.mobile-section-title[data-i18n="kappe_section_fasteners"]');
    if (stiftSection) {
        if (req.stift === true) stiftSection.classList.add('field-required');
        else stiftSection.classList.remove('field-required');
    }
    // Merknad per kappe-line
    document.querySelectorAll('#kappe-lines .kappe-line-merknad').forEach(function(merknadEl) {
        var f = merknadEl.closest('.mobile-field');
        if (f) f.classList.toggle('field-required', req.merknad === true);
    });
    // Leveringsadresse-kort: stjerne på kort-tittel om noen av adressefeltene er obligatoriske
    var deliveryTitle = document.querySelector('#kappe-delivery-card .mobile-order-title');
    if (deliveryTitle) {
        var anyDeliveryReq = ['mottaker','veiadresse','postnr','poststed','kontakt','tlf'].some(function(k) {
            return req[k] === true;
        });
        deliveryTitle.classList.toggle('field-required', anyDeliveryReq);
    }
}

function validateKappeRequiredFields() {
    var req = _getKappeRequired();
    for (var key in KAPPE_FIELD_IDS) {
        if (req[key] !== true) continue;
        var el = document.getElementById(KAPPE_FIELD_IDS[key]);
        if (!el || !(el.value || '').trim()) {
            showNotificationModal(t('validation_required_field') + ' ' + t(KAPPE_FIELD_LABELS[key]));
            if (el) {
                // Expand leveringsadresse-kortet om feltet er skjult der
                var card = el.closest('.kappe-delivery-card');
                if (card) {
                    var wrap = card.querySelector('.mobile-order-body-wrap');
                    if (wrap && !wrap.classList.contains('expanded')) {
                        var header = card.querySelector('.mobile-order-header');
                        if (header) toggleKappeDeliverySection(header);
                    }
                }
                el.focus();
            }
            return false;
        }
    }
    if (req.produkter === true) {
        var lines = document.querySelectorAll('#kappe-lines .kappe-line-card');
        var anyLine = false;
        for (var j = 0; j < lines.length; j++) {
            var card = lines[j];
            var prod = card.querySelector('.kappe-line-product').value;
            if (prod) { anyLine = true; break; }
            var kappRows = card.querySelectorAll('.kappe-kapp-row');
            for (var kr = 0; kr < kappRows.length; kr++) {
                var bredde = kappRows[kr].querySelector('.kappe-line-bredde').value;
                var lm = kappRows[kr].querySelector('.kappe-line-lopemeter').value;
                var sider = kappRows[kr].querySelector('.kappe-line-antall-sider').value;
                if (bredde || lm || sider) { anyLine = true; break; }
            }
            if (anyLine) break;
        }
        // Festemiddel-bare-skjema er gyldig: hvis det finnes festemidler med
        // utfylt antall, kreves ikke en produkt-/kappelinje.
        if (!anyLine) {
            var hasFestemiddel = false;
            document.querySelectorAll('#kappe-stift .kappe-stift-row').forEach(function(row) {
                var s = (row.querySelector('.kappe-stift-stk') || {}).value || '';
                var e = (row.querySelector('.kappe-stift-eske') || {}).value || '';
                if (String(s).trim() || String(e).trim()) hasFestemiddel = true;
            });
            if (!hasFestemiddel) {
                showNotificationModal(t('kappe_validation_no_lines'));
                return false;
            }
        }
    }
    if (req.stift === true) {
        var stiftRows = document.querySelectorAll('#kappe-stift .kappe-stift-row');
        if (!stiftRows.length) {
            showNotificationModal(t('kappe_validation_no_stift'));
            return false;
        }
    }
    if (req.merknad === true) {
        var lineCards = document.querySelectorAll('#kappe-lines .kappe-line-card');
        for (var lc = 0; lc < lineCards.length; lc++) {
            var mEl = lineCards[lc].querySelector('.kappe-line-merknad');
            if (!mEl || !(mEl.value || '').trim()) {
                showNotificationModal(t('validation_required_field') + ' ' + t('kappe_col_merknad') + ' (' + (lc + 1) + ')');
                var wrap2 = lineCards[lc].querySelector('.mobile-order-body-wrap');
                if (wrap2 && !wrap2.classList.contains('expanded')) {
                    var hdr = lineCards[lc].querySelector('.mobile-order-header');
                    if (hdr) hdr.click();
                }
                if (mEl) mEl.focus();
                return false;
            }
        }
    }
    return true;
}

async function saveKappeForm() {
    if (!validateKappeRequiredFields()) return;
    var saveBtn = document.getElementById('kappe-save-btn');
    if (saveBtn && saveBtn.disabled) return;
    if (saveBtn) saveBtn.disabled = true;

    try {
        var data = getKappeFormData();
        var saved = safeParseJSON(KAPPE_STORAGE_KEY, []);
        var archived = safeParseJSON(KAPPE_ARCHIVE_KEY, []);

        var wasSent = sessionStorage.getItem('firesafe_kappe_sent') === '1';
        if (wasSent && _kappeCurrentId) {
            var archivedIdx = archived.findIndex(function(item) { return item.id === _kappeCurrentId; });
            if (archivedIdx !== -1) {
                data.id = _kappeCurrentId;
                archived.splice(archivedIdx, 1);
                safeSetItem(KAPPE_ARCHIVE_KEY, JSON.stringify(archived));
            }
        }

        if (_kappeCurrentId) {
            data.id = _kappeCurrentId;
            var existingIndex = saved.findIndex(function(item) { return item.id === _kappeCurrentId; });
            if (existingIndex !== -1) saved[existingIndex] = data;
            else saved.unshift(data);
        } else {
            data.id = Date.now().toString();
            saved.unshift(data);
        }
        if (saved.length > 50) saved.pop();
        safeSetItem(KAPPE_STORAGE_KEY, JSON.stringify(saved));
        _kappeCurrentId = data.id;
        _kappeLastSavedData = getKappeFormDataSnapshot();
        _lastLocalSaveTs = Date.now();

        sessionStorage.removeItem('firesafe_kappe_sent');
        document.getElementById('kappe-sent-banner').style.display = 'none';
        document.getElementById('btn-kappe-sent').style.display = '';

        showNotificationModal(t('kappe_save_success'), true);
        sessionStorage.setItem('firesafe_kappe_current', JSON.stringify(data));
        if (!wasSent) {
            closeKappeView();
            _showSavedFormsDirectly('kappe');
        }

        if (wasSent) {
            enqueueUserDocMove('kappeforms', 'kappeArchive', data.id, data, 'Kappe save Firebase');
        } else {
            enqueueUserDocSet('kappeforms', data.id, data, 'Kappe save Firebase');
        }
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function markKappeAsSent() {
    try {
        if (!validateKappeRequiredFields()) return;
        var data = getKappeFormData();
        var saved = safeParseJSON(KAPPE_STORAGE_KEY, []);
        if (_kappeCurrentId) data.id = _kappeCurrentId;
        else { data.id = Date.now().toString(); }

        var archived = safeParseJSON(KAPPE_ARCHIVE_KEY, []);
        var archExisting = archived.findIndex(function(item) { return item.id === data.id; });
        if (archExisting !== -1) archived[archExisting] = data;
        else archived.unshift(data);
        safeSetItem(KAPPE_ARCHIVE_KEY, JSON.stringify(archived));

        var savedIdx = saved.findIndex(function(item) { return item.id === data.id; });
        if (savedIdx !== -1) {
            saved.splice(savedIdx, 1);
            safeSetItem(KAPPE_STORAGE_KEY, JSON.stringify(saved));
        }

        sessionStorage.setItem('firesafe_kappe_sent', '1');
        _kappeCurrentId = data.id;
        _kappeLastSavedData = getKappeFormDataSnapshot();
        document.getElementById('kappe-sent-banner').style.display = 'block';
        document.getElementById('btn-kappe-sent').style.display = 'none';
        showNotificationModal(t('marked_as_sent'), true);
        _lastLocalSaveTs = Date.now();
        closeKappeView();
        _showSavedFormsDirectly('kappe');

        enqueueUserDocMove('kappeArchive', 'kappeforms', data.id, data, 'Kappe markAsSent Firebase');
    } catch(e) {
        console.error('Mark kappe as sent error:', e);
    }
}

function loadKappeTab() {
    // Vis cache umiddelbart
    var cachedSaved = safeParseJSON(KAPPE_STORAGE_KEY, []);
    var cachedSent = safeParseJSON(KAPPE_ARCHIVE_KEY, []);
    var cachedForms = cachedSaved.map(function(f) { return Object.assign({}, f, { _isSent: false }); })
        .concat(cachedSent.map(function(f) { return Object.assign({}, f, { _isSent: true }); }))
        .sort(function(a, b) {
            if (a._isSent !== b._isSent) return a._isSent ? 1 : -1;
            return (b.savedAt || '').localeCompare(a.savedAt || '');
        });
    renderKappeFormsList(cachedForms);

    // Refresh fra Firestore — sikrer at skjemaer lagret på en annen enhet vises.
    // Migreringssikker: hvis Firebase er tomt men lokal har data, push lokal i stedet
    // for å overskrive lokal med tomt resultat.
    if (currentUser && db) {
        Promise.all([getKappeForms(), getKappeSentForms()]).then(function(results) {
            if (Date.now() - _lastLocalSaveTs < 5000) return;
            var savedResult = results[0], sentResult = results[1];
            var fbSaved = savedResult.forms || [];
            var fbSent = sentResult.forms || [];
            var localSaved = safeParseJSON(KAPPE_STORAGE_KEY, []);
            var localSent = safeParseJSON(KAPPE_ARCHIVE_KEY, []);

            if (fbSaved.length > 0) {
                safeSetItem(KAPPE_STORAGE_KEY, JSON.stringify(fbSaved.slice(0, 50)));
            } else if (localSaved.length > 0) {
                localSaved.forEach(function(form) {
                    if (form && form.id) {
                        enqueueUserDocSet('kappeforms', form.id, form, 'Migrate kappe save');
                    }
                });
                fbSaved = localSaved;
            }
            if (fbSent.length > 0) {
                safeSetItem(KAPPE_ARCHIVE_KEY, JSON.stringify(fbSent.slice(0, 50)));
            } else if (localSent.length > 0) {
                localSent.forEach(function(form) {
                    if (form && form.id) {
                        enqueueUserDocSet('kappeArchive', form.id, form, 'Migrate kappe sent');
                    }
                });
                fbSent = localSent;
            }

            var allForms = fbSaved.map(function(f) { return Object.assign({}, f, { _isSent: false }); })
                .concat(fbSent.map(function(f) { return Object.assign({}, f, { _isSent: true }); }))
                .sort(function(a, b) {
                    if (a._isSent !== b._isSent) return a._isSent ? 1 : -1;
                    return (b.savedAt || '').localeCompare(a.savedAt || '');
                });
            if (document.body.classList.contains('saved-modal-open')) {
                renderKappeFormsList(allForms);
            }
        }).catch(function(e) { console.error('Refresh kappe forms:', e); });
    }
}

function _buildKappeItemHtml(item, index) {
    var title = item.prosjektnavn || item.prosjektnr || '';
    var subtitle = '';
    var parts = [];
    if (item.prosjektnr && item.prosjektnavn) parts.push(escapeHtml(item.prosjektnr));
    var lineCount = (item.lines || []).filter(function(l) { return l && (l.produkt || l.bredde || l.lopemeter || l.antallSider); }).length;
    if (lineCount) parts.push(lineCount + ' ' + (lineCount === 1 ? 'produkt' : 'produkter'));
    if (parts.length) subtitle = '<div class="saved-item-subtitle">' + parts.join(' <span class="bil-history-sep"></span> ') + '</div>';
    var savedAtStr = formatDateWithTime(item.savedAt);
    var isSent = item._isSent;
    var dot = '<span class="status-dot ' + (isSent ? 'sent' : 'saved') + '"></span>';
    var dupBtn = '<button class="saved-item-action-btn copy" title="' + t('duplicate_btn') + '">' + duplicateIcon + '</button>';
    var deleteBtn = isSent
        ? '<button class="saved-item-action-btn delete disabled" title="' + t('delete_btn') + '">' + deleteIcon + '</button>'
        : '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>';
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-header">' +
                '<div class="saved-item-row1">' + dot + escapeHtml(title || t('no_name')) + (savedAtStr ? '<span class="saved-item-date-inline">' + escapeHtml(savedAtStr) + '</span>' : '') + '</div>' +
            '</div>' +
            subtitle +
        '</div>' +
        '<div class="saved-item-buttons">' + dupBtn + deleteBtn + '</div>' +
    '</div>';
}

function renderKappeFormsList(forms) {
    var listEl = document.getElementById('kappe-list');
    if (!listEl) return;
    if (!forms || forms.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('kappe_no_saved') + '</div>';
        window.loadedKappeForms = [];
        if (_selectMode) updateSelectionUI();
        return;
    }
    window.loadedKappeForms = forms;
    listEl.innerHTML = forms.map(function(item, i) { return _buildKappeItemHtml(item, i); }).join('');
    listEl.querySelectorAll('.saved-item').forEach(function(el, i) { el._formData = window.loadedKappeForms[i]; });
    // Re-applicer .selected-klasse hvis vi er i select-mode (f.eks. etter delete-refresh)
    if (_selectMode && _selectTab === 'kappe') {
        listEl.querySelectorAll('.saved-item').forEach(function(el) {
            var idx = parseInt(el.getAttribute('data-index'), 10);
            if (!isNaN(idx) && _selectedSet.has(idx)) el.classList.add('selected');
        });
        updateSelectionUI();
    }
}

function loadKappeFormDirect(formData) {
    if (!formData) return;
    document.body.classList.remove('saved-modal-open');
    sessionStorage.removeItem('firesafe_hent_tab');

    _kappeCurrentId = formData.id || null;
    setKappeFormData(formData);
    // Hvis ikke sendt: oppdater Dato til dagens (sendte skjema bevarer historisk)
    if (!formData._isSent) _setKappeDatoToday();

    showView('kappe-view');
    document.body.classList.add('kappe-view-open');
    window.location.hash = 'kappe';

    var isSent = !!formData._isSent;
    document.getElementById('kappe-sent-banner').style.display = isSent ? 'block' : 'none';
    document.getElementById('btn-kappe-sent').style.display = isSent ? 'none' : '';
    sessionStorage.setItem('firesafe_kappe_sent', isSent ? '1' : '');
    _kappeLastSavedData = getKappeFormDataSnapshot();
    sessionStorage.setItem('firesafe_kappe_current', _kappeLastSavedData);
    window.scrollTo(0, 0);
}

function duplicateKappeForm(formData) {
    if (!formData) return;
    var copy = JSON.parse(JSON.stringify(formData));
    delete copy.id;
    delete copy._isSent;
    copy.savedAt = new Date().toISOString();

    _kappeCurrentId = null;
    setKappeFormData(copy);
    _setKappeDatoToday();

    document.body.classList.remove('saved-modal-open');
    sessionStorage.removeItem('firesafe_hent_tab');
    showView('kappe-view');
    document.body.classList.add('kappe-view-open');
    window.location.hash = 'kappe';
    document.getElementById('kappe-sent-banner').style.display = 'none';
    document.getElementById('btn-kappe-sent').style.display = '';
    document.getElementById('kappe-save-btn').disabled = false;
    sessionStorage.removeItem('firesafe_kappe_sent');
    _kappeLastSavedData = getKappeFormDataSnapshot();
    sessionStorage.setItem('firesafe_kappe_current', _kappeLastSavedData);
    window.scrollTo(0, 0);
    showNotificationModal(t('duplicated_success'), true);
}

function deleteKappeForm(formData) {
    if (!formData) return;
    var isSent = formData._isSent;
    showConfirmModal(t(isSent ? 'delete_sent_confirm' : 'delete_confirm'), function() {
        var lsKey = isSent ? KAPPE_ARCHIVE_KEY : KAPPE_STORAGE_KEY;
        var collection = isSent ? 'kappeArchive' : 'kappeforms';
        var list = safeParseJSON(lsKey, []);
        var idx = list.findIndex(function(f) { return f.id === formData.id; });
        if (idx !== -1) { list.splice(idx, 1); safeSetItem(lsKey, JSON.stringify(list)); }
        var loadedIdx = (window.loadedKappeForms || []).findIndex(function(f) { return f.id === formData.id; });
        if (loadedIdx !== -1) window.loadedKappeForms.splice(loadedIdx, 1);
        renderKappeFormsList(window.loadedKappeForms);
        _lastLocalSaveTs = Date.now();

        enqueueUserDocDelete(collection, formData.id, 'Kappe delete Firebase');
    });
}

// Event delegation for kappe-list items
(function() {
    var kappeListEl = document.getElementById('kappe-list');
    if (!kappeListEl) return;
    kappeListEl.addEventListener('click', function(e) {
        var item = e.target.closest('.saved-item');
        if (!item) return;
        // I select-mode toggler item-klikk valg, IKKE åpning av skjema
        if (_selectMode && _selectTab === 'kappe') {
            e.preventDefault();
            e.stopPropagation();
            var idx = parseInt(item.dataset.index, 10);
            if (!isNaN(idx)) toggleFormSelection(idx, item);
            return;
        }
        var formData = item._formData;
        if (!formData) return;
        var btn = e.target.closest('button');
        if (btn) {
            e.stopPropagation();
            if (btn.classList.contains('disabled')) return;
            if (btn.classList.contains('copy')) {
                showConfirmModal(t('duplicate_confirm'), function() {
                    duplicateKappeForm(formData);
                }, t('duplicate_btn'));
            } else if (btn.classList.contains('delete')) {
                deleteKappeForm(formData);
            }
            return;
        }
        loadKappeFormDirect(formData);
    });
})();

// ─── Kappe WN630 beregning ──────────────────────────────────────────────────

function _calcKappeWN630(bredde, lopemeter, antallSider, plateLengde, plateBredde, kerf, stabel, antall) {
    // Bredde må være eksakt brukerinput — strip-bredden bestemmer om
    // isolasjonen passer fysisk. Avrunding her ville gitt feil mål.
    var w = parseLocaleNum(bredde) || 0;
    // Løpemeter rundes opp til nærmeste tiendedel slik at kalkulasjonen
    // bruker SAMME verdi som vises i Løpemeter-kolonnen.
    var lm = parseLocaleNum(lopemeter) || 0;
    var sider = parseLocaleNum(antallSider) || 0;
    var ant = parseLocaleNum(antall);
    if (isNaN(ant) || ant <= 0) ant = 1;
    var pL = parseLocaleNum(plateLengde) || 1200;
    var pB = parseLocaleNum(plateBredde) || 1000;
    var k = parseLocaleNum(kerf);
    if (isNaN(k)) k = 2;
    var stabelAntall = Math.max(1, parseInt(stabel) || 1);

    var empty = { langs: [], kerf: k, stabel: stabelAntall };
    if (w <= 0 || lm <= 0 || sider <= 0) return empty;

    var totalLm = Math.ceil(lm * sider * ant * 10) / 10;

    function calcOrient(kuttDim, stripDimMm) {
        var stripes = Math.floor((kuttDim + k) / (w + k));
        if (stripes <= 0) return null;
        var stripLengde = stripDimMm / 1000;
        var antallStk = Math.ceil(totalLm / stripLengde);
        var antallKapp = Math.ceil(antallStk / stabelAntall);
        var svinnPerPlate = kuttDim - (stripes * w + (stripes - 1) * k);
        return {
            antallStk: antallStk,
            antallKapp: antallKapp,
            stripLengdeMm: stripDimMm,
            kuttLangsMm: stripDimMm,
            stripes: stripes,
            svinnPerPlate: Math.round(svinnPerPlate),
            stripLengde: stripLengde
        };
    }

    var langs = [];
    var orientA = calcOrient(pB, pL);
    var orientB = calcOrient(pL, pB);
    if (orientA) langs.push(orientA);
    if (orientB && pL !== pB) langs.push(orientB);

    // Sorter: høyeste langs (kuttLangsMm) først
    langs.sort(function(a, b) { return b.kuttLangsMm - a.kuttLangsMm; });

    return { langs: langs, kerf: k, stabel: stabelAntall };
}

// ─── Kappe export ───────────────────────────────────────────────────────────

function buildKappeExportTable() {
    var data = getKappeFormData();
    var container = document.getElementById('kappe-export-container');

    var lines = (data.lines || []).slice();

    // Gruppering på PLATESTØRRELSE (ikke produkt): linjer med samme plate-
    // størrelse samles, største plate øverst. Stabil sortering (lik plate
    // beholder registrerings-rekkefølge).
    function _plateInfo(l) {
        l = l || {};
        var ln = parseLocaleNum(l.plateLengde);
        var wn = parseLocaleNum(l.plateBredde);
        if (isNaN(ln) || isNaN(wn) || (!ln && !wn)) {
            return { key: '', label: '', area: -1 };
        }
        var hi = Math.max(ln, wn), lo = Math.min(ln, wn);
        return {
            key: hi + 'x' + lo,
            label: formatLocaleNum(hi) + '×' + formatLocaleNum(lo) + 'mm',
            area: hi * lo
        };
    }
    // Sorter for visning (størst plate øverst), men behold ORIGINAL
    // linjenummer (#) slik bruker registrerte dem i skjemaet — eksport-
    // nummeret skal matche skjemaet, ikke sortert posisjon.
    var _sortedLines = lines.map(function(l, idx) { return { l: l, idx: idx, p: _plateInfo(l) }; })
        .sort(function(a, b) {
            if (b.p.area !== a.p.area) return b.p.area - a.p.area; // størst først
            return a.idx - b.idx; // stabil
        });
    lines = _sortedLines.map(function(x) { return x.l; });

    var lev = data.leveringsadresse || {};

    function fmtNum(v) {
        if (!v) return '';
        return String(v).replace('.', ',');
    }

    var headerHtml =
        '<div class="ke-header">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 85" class="firesafe-logo firesafe-logo--sm" preserveAspectRatio="xMidYMid meet">' +
                '<path d="M2.67 37L2.67 11.23L22.36 11.23L22.36 16.77L10.67 16.77L10.67 21.27L20.65 21.27L20.65 26.47L10.67 26.47L10.67 37L2.67 37M26.96 37L26.96 11.23L34.95 11.23L34.95 37L26.96 37M48.76 37L40.76 37L40.76 11.23L54.04 11.23Q57.73 11.23 59.68 11.86Q61.63 12.50 62.82 14.21Q64.02 15.92 64.02 18.38Q64.02 20.53 63.11 22.08Q62.19 23.64 60.59 24.61Q59.57 25.22 57.80 25.63Q59.22 26.10 59.87 26.58Q60.31 26.89 61.15 27.93Q61.98 28.97 62.26 29.53L66.11 37L57.11 37L52.86 29.13Q52.05 27.60 51.42 27.14Q50.55 26.54 49.46 26.54L48.76 26.54L48.76 37M48.76 16.43L48.76 21.67L52.12 21.67Q52.66 21.67 54.23 21.32Q55.02 21.16 55.52 20.51Q56.02 19.86 56.02 19.02Q56.02 17.77 55.23 17.10Q54.44 16.43 52.26 16.43L48.76 16.43M68.64 37L68.64 11.23L89.98 11.23L89.98 16.73L76.62 16.73L76.62 20.83L89.02 20.83L89.02 26.08L76.62 26.08L76.62 31.16L90.37 31.16L90.37 37L68.64 37M93.27 28.47L100.85 28Q101.09 29.85 101.85 30.81Q103.08 32.38 105.36 32.38Q107.07 32.38 107.99 31.58Q108.91 30.78 108.91 29.72Q108.91 28.72 108.04 27.93Q107.16 27.14 103.96 26.44Q98.72 25.26 96.49 23.31Q94.24 21.36 94.24 18.33Q94.24 16.35 95.39 14.58Q96.54 12.81 98.85 11.80Q101.16 10.79 105.19 10.79Q110.13 10.79 112.72 12.63Q115.31 14.46 115.80 18.47L108.30 18.91Q108 17.17 107.04 16.38Q106.08 15.59 104.40 15.59Q103.01 15.59 102.30 16.18Q101.60 16.77 101.60 17.61Q101.60 18.23 102.18 18.72Q102.74 19.23 104.85 19.67Q110.07 20.79 112.33 21.94Q114.59 23.10 115.62 24.80Q116.65 26.51 116.65 28.62Q116.65 31.09 115.28 33.19Q113.91 35.28 111.45 36.36Q108.98 37.44 105.24 37.44Q98.67 37.44 96.13 34.91Q93.60 32.38 93.27 28.47M137.78 37L136.51 32.75L127.44 32.75L126.19 37L118.05 37L127.74 11.23L136.42 11.23L146.11 37L137.78 37M129.16 27.17L134.84 27.17L131.99 17.91L129.16 27.17M148.69 37L148.69 11.23L168.38 11.23L168.38 16.77L156.69 16.77L156.69 21.27L166.68 21.27L166.68 26.47L156.69 26.47L156.69 37L148.69 37M172.65 37L172.65 11.23L193.99 11.23L193.99 16.73L180.63 16.73L180.63 20.83L193.03 20.83L193.03 26.08L180.63 26.08L180.63 31.16L194.38 31.16L194.38 37" fill="currentColor"/>' +
                '<polygon points="187,76 194,76 230,11 223,11" fill="currentColor"/>' +
            '</svg>' +
            '<div class="ke-title">KAPPESKJEMA</div>' +
            '<div class="ke-meta">' +
                '<div><strong>Dato:</strong> ' + escapeHtml(data.dato || '') + '</div>' +
                '<div><strong>Ønsket lev.:</strong> ' + escapeHtml(_kappeFormatDateNO(data.onsketLeveringsdato) || '') + '</div>' +
                '<div><strong>Pallemerking:</strong> ' + escapeHtml(data.pallemerking || '') + '</div>' +
            '</div>' +
        '</div>';

    var infoHtml =
        '<div class="ke-info-grid">' +
            '<div class="ke-info-col">' +
                '<div class="ke-info-col-title">Prosjekt</div>' +
                '<div class="ke-info-row"><span>Avdeling:</span><span>' + escapeHtml(data.avdeling || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Bestiller:</span><span>' + escapeHtml(data.bestiller || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Prosjektnavn:</span><span>' + escapeHtml(data.prosjektnavn || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Prosjektnr.:</span><span>' + escapeHtml(data.prosjektnr || '') + '</span></div>' +
            '</div>' +
            '<div class="ke-info-col">' +
                '<div class="ke-info-col-title">Leveringsadresse</div>' +
                '<div class="ke-info-row"><span>Mottaker:</span><span>' + escapeHtml(lev.mottaker || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Gateadresse:</span><span>' + escapeHtml(lev.veiadresse || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Postnr.:</span><span>' + escapeHtml(lev.postnr || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Poststed:</span><span>' + escapeHtml(lev.poststed || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Kontakt:</span><span>' + escapeHtml(lev.kontakt || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Tlf.:</span><span>' + escapeHtml(lev.tlf || '') + '</span></div>' +
            '</div>' +
        '</div>';

    // Flatten lines with multiple kapp rows into export rows
    var kerf = getKappeKerf();
    var flatRows = [];
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i] || {};
        // Sekvensielt nummer i visnings-rekkefølge (#1, #2, ... ovenfra).
        var _origNr = i + 1;
        var pL = l.plateLengde || '1200';
        var pB = l.plateBredde || '1000';
        var _pinfo = _plateInfo(l);
        var _pKey = _pinfo.key, _pLabel = _pinfo.label;

        // ── Festemiddel-linje ── (egen art: antall i Stk/Eske, ingen kapping)
        if (l.type === 'fast') {
            var legFUnit = l.fastUnit === 'eske' ? 'eske' : 'stk';
            var fastArr = (l.fastRader || []).filter(function(fr) {
                return String((fr && fr.antall) || '').trim() !== '';
            });
            var fTotal = fastArr.length || 1;
            for (var fj = 0; fj < fTotal; fj++) {
                var frow = fastArr[fj] || {};
                flatRows.push({
                    lineIdx: i,
                    plateKey: _pKey, plateLabel: _pLabel,
                    nr: fj === 0 ? _origNr : '',
                    produkt: fj === 0 ? (l.produkt || '') : '',
                    plateLengde: '',
                    plateBredde: '',
                    isFast: true,
                    fastAntall: frow.antall || '',
                    // Per-rad enhet; fall tilbake til eldre linje-fastUnit.
                    fastUnit: frow.unit === 'eske' ? 'eske' : (frow.unit === 'stk' ? 'stk' : legFUnit),
                    merknad: fj === 0 ? (l.merknad || '') : '',
                    lineFirst: fj === 0,
                    lineSpan: fTotal
                });
            }
            continue;
        }

        // Begge modi kan eksporteres samtidig for samme linje: først
        // kappeliste (Stk), deretter "hele plater" (Plate). nr/produkt
        // rowspanner over ALLE underrader (kapp-grupper + plate-rader).

        // ── Kapp-grupper (Stk) ──
        // Backward compat: gammelt format hadde bredde/lopemeter/antallSider direkte.
        var kappArrRaw = (l.kapp && l.kapp.length)
            ? l.kapp
            : ((l.bredde || l.lopemeter || l.antallSider)
                ? [{ bredde: l.bredde || '', lopemeter: l.lopemeter || '', antallSider: l.antallSider || '' }]
                : []);
        // Hopp over tomme kapp-rader (ingen bredde og ingen løpemeter).
        var kappArr = kappArrRaw.filter(function(ka) {
            return String(ka.bredde || '').trim() !== '' || String(ka.lopemeter || '').trim() !== '';
        });
        var widthGroups = {};
        var widthOrder = [];
        for (var ki = 0; ki < kappArr.length; ki++) {
            var ka = kappArr[ki];
            var widthKey = String(parseLocaleNum(ka.bredde));
            if (!widthGroups[widthKey]) {
                widthGroups[widthKey] = { bredde: ka.bredde, totalLm: 0 };
                widthOrder.push(widthKey);
            }
            var lmK = parseLocaleNum(ka.lopemeter) || 0;
            var sidK = parseLocaleNum(ka.antallSider) || 0;
            var antK = parseLocaleNum(ka.antall);
            if (isNaN(antK) || antK <= 0) antK = 1;
            widthGroups[widthKey].totalLm += lmK * sidK * antK;
        }

        // ── Plate-rader (hele plater) ──
        // Backward compat: gammelt enkelt plateAntall → én rad.
        var plateArrRaw = (l.plateRader && l.plateRader.length)
            ? l.plateRader
            : (l.plateAntall ? [{ antall: l.plateAntall }] : []);
        var plateArr = plateArrRaw.filter(function(pr) {
            return String((pr && pr.antall) || '').trim() !== '';
        });

        // Totalt antall underrader for denne linjen (for rowspan).
        var subTotal = widthOrder.length + plateArr.length;
        if (subTotal === 0) subTotal = 1; // tom linje → vis produktet likevel
        var si = 0;

        for (var gi = 0; gi < widthOrder.length; gi++) {
            var grp = widthGroups[widthOrder[gi]];
            // Send kombinert totalLm som lopemeter, sider=1 og antall=1 så
            // _calcKappeWN630 bruker totalLm direkte uten å multiplisere.
            var wn630 = _calcKappeWN630(grp.bredde, grp.totalLm, '1', pL, pB, kerf, '1', '1');
            var best = wn630.langs.length ? wn630.langs[0] : null;
            flatRows.push({
                lineIdx: i,
                plateKey: _pKey, plateLabel: _pLabel,
                nr: si === 0 ? _origNr : '',
                produkt: si === 0 ? (l.produkt || '') : '',
                plateLengde: si === 0 ? pL : '',
                plateBredde: si === 0 ? pB : '',
                bredde: grp.bredde || '',
                // Kombinert LM (allerede × Sider × Antall)
                lopemeter: grp.totalLm,
                antall: '1',
                antallSider: '1',
                merknad: (si === 0) ? (l.merknad || '') : '',
                wn630: wn630,
                totaltM2: best ? (best.antallStk * best.stripLengde * ((parseLocaleNum(grp.bredde) || 0) / 1000)) : '',
                lineFirst: si === 0,
                lineSpan: subTotal
            });
            si++;
        }

        for (var pj = 0; pj < plateArr.length; pj++) {
            var prow = plateArr[pj] || {};
            flatRows.push({
                lineIdx: i,
                plateKey: _pKey, plateLabel: _pLabel,
                nr: si === 0 ? _origNr : '',
                produkt: si === 0 ? (l.produkt || '') : '',
                plateLengde: si === 0 ? pL : '',
                plateBredde: si === 0 ? pB : '',
                // Plate-mål alltid med for m²-beregning (uavhengig av lineFirst).
                plateLmm: pL,
                plateWmm: pB,
                isPlate: true,
                plateAntall: prow.antall || '',
                merknad: si === 0 ? (l.merknad || '') : '',
                lineFirst: si === 0,
                lineSpan: subTotal
            });
            si++;
        }

        // Linje med produkt men uten kapp/plate-data: vis produktet med tom
        // rad. Helt tom linje (intet produkt heller) hoppes HELT over —
        // ingen "spøkelses-rad" med default plate-dim i eksporten.
        if (si === 0 && String(l.produkt || '').trim()) {
            flatRows.push({
                lineIdx: i,
                plateKey: _pKey, plateLabel: _pLabel,
                nr: _origNr,
                produkt: l.produkt || '',
                plateLengde: pL,
                plateBredde: pB,
                bredde: '',
                lopemeter: '',
                antall: '1',
                antallSider: '1',
                merknad: l.merknad || '',
                wn630: null,
                totaltM2: '',
                lineFirst: true,
                lineSpan: 1
            });
        }
    }

    var productRows = '';
    // Delsum PER PLATESTØRRELSE: m²/veil-sum per langs (kapperetning) når
    // plate-gruppen avsluttes. Hele plater legges til HVER langs-sum
    // (= totalt materiale for plata med den kapperetningen + hele plater
    // som uansett trengs). Kun hele plater → egen "SUM hele plater"-rad.
    var _lineSums = {};
    var _plateWholeM2 = 0;
    var _plateWholeVeil = 0;
    var _curPlateKey = null;
    var _curPlateLabel = '';
    var _anyCut = false;
    function _flushKappeLineSum() {
        var keys = Object.keys(_lineSums).map(Number).sort(function(a, b) { return b - a; });
        if (keys.length) {
            keys.forEach(function(langs) {
                var s = _lineSums[langs];
                productRows +=
                    '<tr class="ke-sum-row">' +
                        '<td colspan="5" class="ke-sum-label">SUM langs ' + langs + 'mm</td>' +
                        '<td class="ke-sum-value">' + fmtNum((s.m2 + _plateWholeM2).toFixed(2)) + '</td>' +
                        '<td class="ke-sum-value">' + fmtNum((s.veil + _plateWholeVeil).toFixed(2)) + '</td>' +
                    '</tr>';
            });
        } else if (_plateWholeM2 > 0) {
            productRows +=
                '<tr class="ke-sum-row">' +
                    '<td colspan="5" class="ke-sum-label">SUM hele plater</td>' +
                    '<td class="ke-sum-value">' + fmtNum(_plateWholeM2.toFixed(2)) + '</td>' +
                    '<td class="ke-sum-value">' + fmtNum(_plateWholeVeil.toFixed(2)) + '</td>' +
                '</tr>';
        }
        _lineSums = {};
        _plateWholeM2 = 0;
        _plateWholeVeil = 0;
    }
    for (var ri = 0; ri < flatRows.length; ri++) {
        var r = flatRows[ri];
        // Platestørrelse-grense → skriv forrige gruppes delsum først.
        if (_curPlateKey !== null && r.plateKey !== _curPlateKey) _flushKappeLineSum();
        _curPlateKey = r.plateKey;
        _curPlateLabel = r.plateLabel || _curPlateLabel;
        var nrContent = r.nr ? ('#' + r.nr) : '';
        if (r.merknad) nrContent += (r.nr ? ' · ' : '') + '<span class="ke-merknad">' + escapeHtml(r.merknad) + '</span>';

        // Plate-modus: hele plater, ingen kapp/WN630 — vis "{N} plater".
        if (r.isPlate) {
            var pSpanAttr = r.lineSpan > 1 ? ' rowspan="' + r.lineSpan + '"' : '';
            var ppCellHtml = '';
            if (r.lineFirst) {
                ppCellHtml = '<div class="ke-produkt-name">' + escapeHtml(r.produkt) + '</div>';
                if (r.plateLengde && r.plateBredde) {
                    var ppLn = parseLocaleNum(r.plateLengde);
                    var ppBn = parseLocaleNum(r.plateBredde);
                    var ppDisp = (!isNaN(ppLn) && !isNaN(ppBn))
                        ? formatLocaleNum(Math.max(ppLn, ppBn)) + '×' + formatLocaleNum(Math.min(ppLn, ppBn)) + 'mm'
                        : escapeHtml(r.plateLengde) + '×' + escapeHtml(r.plateBredde) + 'mm';
                    ppCellHtml += '<div class="ke-produkt-plate">' + ppDisp + '</div>';
                }
            }
            // Samme kolonne-struktur som kapp-rader (konsistent, ~2 linjer
            // høyt). "N hele plater" i Bredde+Løpemeter, WN630 = leveres
            // hele, Totalt m² + Veil m² (+10%) fylles fra plateareal.
            var pAnt = parseLocaleNum(r.plateAntall);
            var pLmm = parseLocaleNum(r.plateLmm);
            var pWmm = parseLocaleNum(r.plateWmm);
            var pM2Html = '', pVeilHtml = '';
            if (!isNaN(pAnt) && pAnt > 0 && !isNaN(pLmm) && !isNaN(pWmm) && pLmm > 0 && pWmm > 0) {
                var pM2 = pAnt * (pLmm / 1000) * (pWmm / 1000);
                pM2Html = fmtNum(pM2.toFixed(2));
                pVeilHtml = fmtNum((pM2 * 1.10).toFixed(2));
                // Hele plater teller med i plate-gruppens SUM.
                _plateWholeM2 += pM2;
                _plateWholeVeil += pM2 * 1.10;
            }
            productRows +=
                '<tr>' +
                    (r.lineFirst ? '<td class="ke-td-nr"' + pSpanAttr + '>' + nrContent + '</td>' : '') +
                    (r.lineFirst ? '<td class="ke-td-produkt"' + pSpanAttr + '>' + ppCellHtml + '</td>' : '') +
                    '<td colspan="2" class="ke-td-bredde">' + escapeHtml(String(r.plateAntall || '')) + ' hele plater</td>' +
                    '<td class="ke-td-wn630"><div class="ke-wn630-row">Leveres hele – ingen kapping</div></td>' +
                    '<td>' + pM2Html + '</td>' +
                    '<td>' + pVeilHtml + '</td>' +
                '</tr>';
            continue;
        }

        // Festemiddel-linje: antall i Stk/Eske, ingen kapping/WN630.
        if (r.isFast) {
            var fSpanAttr = r.lineSpan > 1 ? ' rowspan="' + r.lineSpan + '"' : '';
            var fpCellHtml = r.lineFirst
                ? '<div class="ke-produkt-name">' + escapeHtml(r.produkt) + '</div>'
                : '';
            var fUnitLabel = r.fastUnit === 'eske' ? t('kappe_unit_eske') : t('kappe_unit_stk');
            productRows +=
                '<tr>' +
                    (r.lineFirst ? '<td class="ke-td-nr"' + fSpanAttr + '>' + nrContent + '</td>' : '') +
                    (r.lineFirst ? '<td class="ke-td-produkt"' + fSpanAttr + '>' + fpCellHtml + '</td>' : '') +
                    '<td colspan="5" class="ke-plate-cell"><strong>' + escapeHtml(String(r.fastAntall || '')) + ' ' + escapeHtml(fUnitLabel.toLowerCase()) + '</strong> <span class="ke-plate-note">(festemiddel)</span></td>' +
                '</tr>';
            continue;
        }

        // WN630, Totalt m² og Veil. m²: én linje per orientering, justert
        var wn630Html = '';
        var totaltHtml = '';
        var veilHtml = '';
        if (r.wn630 && r.wn630.langs.length) {
            var breddeM = (parseLocaleNum(r.bredde) || 0) / 1000;
            for (var oi = 0; oi < r.wn630.langs.length; oi++) {
                var o = r.wn630.langs[oi];
                if (oi > 0) {
                    wn630Html += '<div class="ke-wn630-sep"></div>';
                    totaltHtml += '<div class="ke-wn630-sep"></div>';
                    veilHtml += '<div class="ke-wn630-sep"></div>';
                }
                var sagkutt2 = Math.ceil(o.antallStk / 2);
                wn630Html += '<div class="ke-wn630-row">' +
                    '<strong>' + o.antallStk + ' stk</strong>' +
                    ' (' + sagkutt2 + ' stk i 2-stabel)' +
                    ' · langs ' + o.kuttLangsMm + 'mm' +
                    ' · rest ' + o.svinnPerPlate + 'mm' +
                '</div>';
                var pieces2Stabel = 2 * Math.ceil(o.antallStk / 2);
                var orientM2 = pieces2Stabel * o.stripLengde * breddeM;
                totaltHtml += '<div class="ke-wn630-row">' + fmtNum(orientM2.toFixed(2)) + '</div>';
                veilHtml += '<div class="ke-wn630-row">' + fmtNum((orientM2 * 1.10).toFixed(2)) + '</div>';
                var langsKey = o.kuttLangsMm;
                if (!_lineSums[langsKey]) _lineSums[langsKey] = { m2: 0, veil: 0, langs: langsKey };
                _lineSums[langsKey].m2 += orientM2;
                _lineSums[langsKey].veil += orientM2 * 1.10;
                _anyCut = true;
            }
        }

        var lmNum = parseLocaleNum(r.lopemeter);
        var sdNum = parseLocaleNum(r.antallSider);
        var antNum = parseLocaleNum(r.antall);
        if (isNaN(antNum) || antNum <= 0) antNum = 1;
        var totalLm = '';
        if (!isNaN(lmNum) && !isNaN(sdNum) && lmNum > 0 && sdNum > 0) {
            var totLm = lmNum * sdNum * antNum;
            // Rund opp til nærmeste tiendedel slik at vi aldri mangler materialer
            totalLm = (Math.ceil(totLm * 10) / 10).toFixed(1).replace('.', ',');
        }
        var breddeNum = parseLocaleNum(r.bredde);
        var breddeDisplay;
        if (isNaN(breddeNum)) {
            breddeDisplay = escapeHtml(r.bredde || '');
        } else {
            // Vis minst 1 desimal for tabellkonsistens (260 → "260,0"),
            // men bevar flere desimaler hvis bruker har skrevet det (260,55 → "260,55").
            var bs = String(breddeNum);
            if (bs.indexOf('.') === -1) bs += '.0';
            breddeDisplay = bs.replace('.', ',');
        }

        var spanAttr = r.lineSpan > 1 ? ' rowspan="' + r.lineSpan + '"' : '';
        var produktCell = '';
        if (r.lineFirst) {
            produktCell = '<div class="ke-produkt-name">' + escapeHtml(r.produkt) + '</div>';
            if (r.plateLengde && r.plateBredde) {
                var pLn = parseLocaleNum(r.plateLengde);
                var pBn = parseLocaleNum(r.plateBredde);
                var plateDisplay;
                if (!isNaN(pLn) && !isNaN(pBn)) {
                    var hi = Math.max(pLn, pBn);
                    var lo = Math.min(pLn, pBn);
                    plateDisplay = formatLocaleNum(hi) + '×' + formatLocaleNum(lo) + 'mm';
                } else {
                    plateDisplay = escapeHtml(r.plateLengde) + '×' + escapeHtml(r.plateBredde) + 'mm';
                }
                produktCell += '<div class="ke-produkt-plate">' + plateDisplay + '</div>';
            }
        }
        productRows +=
            '<tr>' +
                (r.lineFirst ? '<td class="ke-td-nr"' + spanAttr + '>' + nrContent + '</td>' : '') +
                (r.lineFirst ? '<td class="ke-td-produkt"' + spanAttr + '>' + produktCell + '</td>' : '') +
                '<td class="ke-td-bredde">' + breddeDisplay + '</td>' +
                '<td class="ke-td-lm">' + escapeHtml(totalLm) + '</td>' +
                '<td class="ke-td-wn630">' + wn630Html + '</td>' +
                '<td>' + totaltHtml + '</td>' +
                '<td>' + veilHtml + '</td>' +
            '</tr>';
    }

    // Siste linjes delsum.
    _flushKappeLineSum();
    // Felles bunn-note for bladbredde (kun relevant når noe er kappet).
    if (_anyCut) {
        productRows +=
            '<tr class="ke-sum-row ke-kerf-foot">' +
                '<td colspan="7" class="ke-sum-label" style="text-align:left;padding-left:10px">' +
                    'Bladbredde brukt i beregning: <strong>' + kerf + 'mm</strong>' +
                '</td>' +
            '</tr>';
    }

    var productsTable =
        '<div class="ke-section-title">Kappeliste</div>' +
        '<table class="ke-products-table">' +
            '<colgroup>' +
                '<col style="width:23%">' +
                '<col style="width:15%">' +
                '<col style="width:9%">' +
                '<col style="width:9%">' +
                '<col style="width:26%">' +
                '<col style="width:9%">' +
                '<col style="width:9%">' +
            '</colgroup>' +
            '<thead>' +
                '<tr>' +
                    '<th>Merknad</th>' +
                    '<th>Produkt</th>' +
                    '<th>Bredde (mm)</th>' +
                    '<th>Løpemeter</th>' +
                    '<th>WN630</th>' +
                    '<th>Totalt m²</th>' +
                    '<th>Veil. m²<br>(+10% svinn)</th>' +
                '</tr>' +
            '</thead>' +
            '<tbody>' + productRows + '</tbody>' +
        '</table>';

    var fastenerRowsData = data.fasteners || data.stift || [];
    var stiftRows = '';
    fastenerRowsData.forEach(function(item) {
        if (!item) return;
        var productName = item.produkt || item.product || MATERIAL_STIFT_LAUNCHER;
        var size = item.storrelse || item['størrelse'] || item.enhet || '';
        // Nytt format: {stk, eske}. Eldre: {antall, enhetType}.
        var stkV = '', eskeV = '';
        if (item.stk != null || item.eske != null) {
            stkV = String(item.stk || '').trim();
            eskeV = String(item.eske || '').trim();
        } else if (item.antall) {
            var u = item.enhetType || item.unit || item.quantityUnit || getKappeProductDefaultUnit(productName) || 'stk';
            if (String(u).toLowerCase() === 'eske') eskeV = String(item.antall).trim();
            else stkV = String(item.antall).trim();
        }
        if (!stkV && !eskeV) return;
        // Egne kolonner for Stk og Eske — utvetydig (45 stk OG 2 eske, ikke
        // "45 stk = 2 eske").
        stiftRows +=
            '<tr>' +
                '<td class="ke-stift-size">' + escapeHtml(productName + (size ? ' ' + _formatDimMm(size) : '')) + '</td>' +
                '<td class="ke-stift-antall">' + escapeHtml(stkV) + '</td>' +
                '<td class="ke-stift-antall">' + escapeHtml(eskeV) + '</td>' +
            '</tr>';
    });

    // Festemidler er en egen seksjon i skjemaet → vis alltid i eksporten.
    // Egne kolonner Stk/Eske (konsistent med skjemaet, utvetydig).
    var stiftTable =
        '<div class="ke-section-title">' + escapeHtml(getKappeFastenerLabel()) + '</div>' +
        '<table class="ke-stift-table">' +
            '<colgroup><col style="width:60%"><col style="width:20%"><col style="width:20%"></colgroup>' +
            '<thead><tr><th>Produkt/dimensjon</th><th>' + escapeHtml(t('kappe_unit_stk')) + '</th><th>' + escapeHtml(t('kappe_unit_eske')) + '</th></tr></thead>' +
            '<tbody>' + stiftRows + '</tbody>' +
        '</table>';

    container.innerHTML =
        '<div class="kappe-export-page">' +
            headerHtml + infoHtml + productsTable + stiftTable +
        '</div>';

    return container;
}

async function renderKappeToCanvas() {
    var container = buildKappeExportTable();
    container.style.display = 'block';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '1250px';
    container.style.visibility = 'hidden';
    container.style.zIndex = '-1';

    await new Promise(function(resolve) { requestAnimationFrame(function() { requestAnimationFrame(resolve); }); });
    container.style.visibility = 'visible';
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '';

    var canvas = await html2canvas(container, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    });

    container.style.display = 'none';
    container.style.position = '';
    container.style.left = '';
    container.style.width = '';
    container.style.visibility = '';
    container.style.zIndex = '';

    return canvas;
}

function getKappeExportFilename(ext) {
    var data = getKappeFormData();
    return _filenameForForm(data, 0, 'kappe', ext);
}

async function doKappeExportPDF(markSent) {
    if (!validateKappeRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderKappeToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
        pdf.save(getKappeExportFilename('pdf'));
        if (markSent) markKappeAsSent();
    } catch(error) {
        showNotificationModal(t('export_pdf_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doKappeExportPNG(markSent) {
    if (!validateKappeRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderKappeToCanvas();
        var link = document.createElement('a');
        link.download = getKappeExportFilename('png');
        link.href = canvas.toDataURL('image/png');
        link.click();
        if (markSent) markKappeAsSent();
    } catch(error) {
        showNotificationModal(t('export_png_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doKappeSharePDF(markSent) {
    if (!validateKappeRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderKappeToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
        var blob = pdf.output('blob');
        var file = new File([blob], getKappeExportFilename('pdf'), { type: 'application/pdf' });
        loading.classList.remove('active');
        var result = await _safeShare([file]);
        if (result === 'shared' && markSent) markKappeAsSent();
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doKappeSharePNG(markSent) {
    if (!validateKappeRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderKappeToCanvas();
        var dataUrl = canvas.toDataURL('image/png');
        var res = await fetch(dataUrl);
        var blob = await res.blob();
        var file = new File([blob], getKappeExportFilename('png'), { type: 'image/png' });
        loading.classList.remove('active');
        var result = await _safeShare([file]);
        if (result === 'shared' && markSent) markKappeAsSent();
    } catch (e) {
        showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

function showKappeExportMenu() {
    var popup = document.getElementById('action-popup');
    document.getElementById('action-popup-title').textContent = t('export_title');
    var buttonsEl = document.getElementById('action-popup-buttons');
    var isSent = sessionStorage.getItem('firesafe_kappe_sent') === '1';
    var checkboxHtml = isSent ? '' :
        '<label style="display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;font-size:14px;padding:8px 0">' +
            '<input type="checkbox" id="kappe-export-mark-sent" style="width:22px;height:22px;accent-color:#E8501A;flex-shrink:0">' +
            t('export_and_mark_label') +
        '</label>';
    var shareIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    var canShare = !!(navigator.share && navigator.canShare);
    var shareBtnPDF = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doKappeSharePDF(document.getElementById(\'kappe-export-mark-sent\')?.checked); closeActionPopup()">' + shareIcon + ' PDF</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PDF</button>';
    var shareBtnPNG = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doKappeSharePNG(document.getElementById(\'kappe-export-mark-sent\')?.checked); closeActionPopup()">' + shareIcon + ' PNG</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PNG</button>';
    buttonsEl.innerHTML = checkboxHtml +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('export_download') + '</div>' +
        '<div class="confirm-modal-buttons" style="margin-bottom:12px">' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doKappeExportPDF(document.getElementById(\'kappe-export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PDF</button>' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doKappeExportPNG(document.getElementById(\'kappe-export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PNG</button>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px">' + t('btn_share') + '</div>' +
        '<div class="confirm-modal-buttons">' +
            shareBtnPDF + shareBtnPNG +
        '</div>';
    popup.classList.add('active');
}

function openKappePreview() {
    var container = buildKappeExportTable();
    container.style.display = 'block';
    container.style.width = '1250px';
    container.style.overflow = 'hidden';

    var scroll = document.getElementById('preview-scroll');
    scroll.appendChild(container);

    window._kappePreviewActive = true;
    window._previewSavedScroll = _saveScrollPositions();
    document.getElementById('preview-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('preview-active');

    // Hide sign button — kappeskjema has no signature
    var signBtn = document.querySelector('.preview-sign-btn');
    if (signBtn) signBtn.style.display = 'none';
    var closeBtn = document.querySelector('.preview-close-btn');
    if (closeBtn) closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ' + t('btn_close');

    requestAnimationFrame(function() {
        updateKappePreviewScale();
        var baseScale = Math.min(scroll.clientWidth / 1250, 1);
        if (baseScale < 1) initPreviewPinchZoom(scroll, container, baseScale);
    });

    window._previewResizeHandler = _onKappePreviewViewportChange;
    window.addEventListener('resize', window._previewResizeHandler);
    window.addEventListener('orientationchange', window._previewResizeHandler);
}

function _onKappePreviewViewportChange() {
    clearTimeout(window._kappePreviewOrientTimer);
    window._kappePreviewOrientTimer = setTimeout(function() {
        updateKappePreviewScale();
        cleanupPreviewPinchZoom();
        var scroll = document.getElementById('preview-scroll');
        var container = document.getElementById('kappe-export-container');
        if (!scroll || !container) return;
        var baseScale = Math.min(scroll.clientWidth / 1250, 1);
        if (baseScale < 1) initPreviewPinchZoom(scroll, container, baseScale);
    }, 200);
}

function updateKappePreviewScale() {
    var overlay = document.getElementById('preview-overlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    var container = document.getElementById('kappe-export-container');
    var scroll = document.getElementById('preview-scroll');
    if (!container || !scroll) return;

    // Wipe any lingering inline styles
    container.style.transform = '';
    container.style.transformOrigin = '';
    container.style.marginLeft = '';
    container.style.marginRight = '';
    container.style.marginBottom = '';

    var header = document.querySelector('.preview-overlay-header');
    var cs = getComputedStyle(scroll);
    var padLR = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var availWidth = scroll.clientWidth - padLR;
    var formHeight = container.offsetHeight;
    // PC (≥1400px med mus): cap til 800px for å matche resten av appens bredde.
    // Mobil/nettbrett: full bredde for konsistens.
    var isDesktop = window.matchMedia('(min-width: 1400px) and (hover: hover) and (pointer: fine)').matches;
    var maxRenderedWidth = isDesktop ? 800 : availWidth;
    var scale = maxRenderedWidth / 1250;

    var renderedWidth = 1250 * scale;
    var translateX = Math.max(0, (availWidth - renderedWidth) / 2);
    container.style.transformOrigin = 'top left';
    container.style.transform = 'translate(' + translateX + 'px, 0) scale(' + scale + ')';
    container.style.marginBottom = (-(formHeight * (1 - scale))) + 'px';
    container.style.marginRight = -(1250 - renderedWidth - translateX) + 'px';
    container.style.marginLeft = '0';
    if (header) { header.style.maxWidth = renderedWidth + 'px'; header.style.margin = '0 auto'; }

    window._previewBaseScale = scale;
    window._previewCurrentScale = scale;
}

// ─── Kappe product settings CRUD ───────────────────────────────────────────

function _kappeSettingsItemHtml(name, idx, editFn, removeFn) {
    return '<div class="settings-list-item settings-action-row" data-idx="' + idx + '">' +
        '<div class="settings-list-item-main">' +
            '<div class="settings-list-item-name">' + escapeHtml(name) + '</div>' +
        '</div>' +
        '<div class="settings-list-item-actions">' +
            '<button type="button" class="settings-item-edit" onclick="' + editFn + '(' + idx + ')" title="' + t('edit_btn') + '">' + editIcon + '</button>' +
            '<button type="button" class="settings-item-remove" onclick="' + removeFn + '(' + idx + ')" title="' + t('delete_btn') + '">' + deleteIcon + '</button>' +
        '</div>' +
    '</div>';
}

function _kappeProductSettingsItemHtml(product, idx) {
    // Varianter er fjernet — enhet låses av popup-modus (Bredde/Plate for isolasjon,
    // Stk/Eske for festemiddel). Produktet trenger kun navn + type.
    return '<div class="settings-material-group kappe-product-settings-group">' +
        '<div class="settings-material-header">' +
            '<div class="settings-material-name-wrap">' +
                '<span class="settings-material-name-display settings-kappe-product-name-display">' + escapeHtml(product.name) + '</span>' +
            '</div>' +
            '<button class="settings-material-type-btn" onclick="event.stopPropagation();openKappeProductTypePicker(this,' + idx + ')" data-value="' + (product.type || 'isolasjon') + '">' + _getKappeProductTypeLabel(product.type) + '</button>' +
            '<button class="settings-material-edit-btn" onclick="event.stopPropagation();editKappeProduct(' + idx + ')" title="' + t('edit_btn') + '">' + editIcon + '</button>' +
            '<button class="settings-delete-btn" onclick="event.stopPropagation();removeKappeProduct(' + idx + ')" title="' + t('delete_btn') + '">' + deleteIcon + '</button>' +
        '</div>' +
    '</div>';
}

function _getKappeProductTypeLabel(type) {
    return type === 'festemiddel' ? t('kappe_product_type_festemiddel') : t('kappe_product_type_isolasjon');
}

function _getKappeProductTypeDesc(type) {
    return type === 'festemiddel' ? 'stk, eske' : 'meter, pakker';
}

function _getKappeProductTypeIcon(type) {
    return type === 'festemiddel' ? '•' : 'm';
}

function toggleKappeProductExpand(headerEl) {
    var group = headerEl.closest('.settings-material-group');
    if (group) group.classList.toggle('expanded');
}

function _renderKappeProductTypePicker(currentValue, onSelect) {
    var existing = document.querySelector('.mat-type-backdrop');
    if (existing) { closeMatTypeDropdown(); return; }
    var types = [
        { value: 'isolasjon', desc: 'Løpende meter eller pakker' },
        { value: 'festemiddel', desc: 'Stk eller eske' }
    ];
    var backdrop = document.createElement('div');
    backdrop.className = 'mat-type-backdrop';
    backdrop.onclick = function() { closeMatTypeDropdown(); };
    var dropdown = document.createElement('div');
    dropdown.className = 'mat-type-dropdown';
    types.forEach(function(typeInfo) {
        var value = typeInfo.value;
        var isActive = value === currentValue;
        var item = document.createElement('div');
        item.className = 'mat-type-dropdown-item' + (isActive ? ' active' : '');
        item.innerHTML =
            '<div class="mat-type-icon">' + escapeHtml(_getKappeProductTypeIcon(value)) + '</div>' +
            '<div class="mat-type-text">' +
                '<div class="mat-type-label">' + escapeHtml(_getKappeProductTypeLabel(value)) + '</div>' +
                '<div class="mat-type-desc">' + escapeHtml(typeInfo.desc) + '</div>' +
            '</div>' +
            '<div class="mat-type-check">' + (isActive ? '✓' : '') + '</div>';
        item.onclick = function(e) {
            e.stopPropagation();
            closeMatTypeDropdown();
            if (value !== currentValue) onSelect(value);
        };
        dropdown.appendChild(item);
    });
    document.body.appendChild(backdrop);
    document.body.appendChild(dropdown);
    requestAnimationFrame(function() {
        backdrop.classList.add('visible');
        dropdown.classList.add('visible');
    });
}

function openKappeProductTypePicker(btn, idx) {
    _renderKappeProductTypePicker(btn.dataset.value || 'isolasjon', function(value) {
        changeKappeProductType(idx, value);
    });
}

function openNewKappeProductTypePicker() {
    var sel = document.getElementById('settings-new-kappe-type');
    if (!sel) return;
    _renderKappeProductTypePicker(sel.value || 'isolasjon', function(value) {
        sel.value = value;
        var btn = document.getElementById('settings-new-kappe-type-btn');
        if (btn) {
            btn.dataset.value = value;
            btn.textContent = _getKappeProductTypeLabel(value);
            btn.setAttribute('data-i18n', 'kappe_product_type_' + value);
        }
        updateKappeNewProductUnitPlaceholder();
    });
}

function updateKappeNewProductUnitPlaceholder() {
    var sel = document.getElementById('settings-new-kappe-type');
    var unitsEl = document.getElementById('settings-new-kappe-units');
    if (!sel || !unitsEl) return;
    var type = sel.value === 'festemiddel' ? 'festemiddel' : 'isolasjon';
    unitsEl.placeholder = _getKappeProductTypeDesc(type);
}

// Sorterer dimensjoner/stift-størrelser numerisk når mulig, ellers alfabetisk.
// Mutates the array in place.
function _sortKappeNumeric(arr) {
    arr.sort(function(a, b) {
        var na = parseFloat(String(a).replace(',', '.'));
        var nb = parseFloat(String(b).replace(',', '.'));
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b), 'no');
    });
}

function _parseKappeUnits(value, type) {
    var units = String(value || '').split(',').map(function(unit) {
        return unit.trim();
    }).filter(Boolean);
    return units;
}

function _saveKappeCatalog(catalog) {
    // Bevar plates fra catalog-arg hvis gitt, ellers les eksisterende fra getKappeCatalog().
    var plates = Array.isArray(catalog.plates) ? catalog.plates : (getKappeCatalog().plates || []);
    var normalized = _buildKappeCatalog(catalog.products || [], catalog.dimensions || [], plates);
    _syncKappeSetting(KAPPE_CATALOG_KEY, 'kappe_catalog', normalized);
}

// Lagrer ny products-array + felles dimensions-liste atomisk til localStorage og Firebase.
function _saveKappeProducts(products, dimensions) {
    _saveKappeCatalog({ products: products, dimensions: dimensions });
}

// Lagrer plate-register (bevarer eksisterende products + dimensions).
function _saveKappePlates(plates) {
    var catalog = getKappeCatalog();
    _saveKappeCatalog({ products: catalog.products || [], dimensions: catalog.dimensions || [], plates: plates });
}

// ─── Plate-register UI ────────────────────────────────────────────────────

function renderKappePlateSettings() {
    var container = document.getElementById('settings-kappe-plate-items');
    if (!container) return;
    var plates = (getKappeCatalog().plates || []).slice();
    var countEl = document.getElementById('settings-count-kappe-plates');
    if (countEl) countEl.textContent = plates.length ? '(' + plates.length + ')' : '';
    container.innerHTML = plates.map(function(p, idx) {
        var pn = p.productNames || [];
        var tagsHtml = pn.map(function(name, ni) {
            return '<span class="settings-plate-tag">' + escapeHtml(name) +
                '<button type="button" class="settings-plate-tag-remove" onclick="unassignKappePlateProduct(' + idx + ',' + ni + ')" aria-label="Fjern">×</button>' +
            '</span>';
        }).join('');
        var assignBtn = '<button type="button" class="settings-plate-assign-btn" onclick="openKappePlateAssignModal(' + idx + ')">+ Tilknytt</button>';
        var emptyHint = !pn.length ? '<span class="settings-plate-empty">Ingen tildelte produkter</span>' : '';
        // Siste gjenværende plate kan ikke slettes (trengs som fallback for uassignede produkter).
        var canDelete = plates.length > 1;
        return '<div class="settings-plate-item" data-idx="' + idx + '">' +
            '<div class="settings-plate-header">' +
                '<span class="settings-plate-dim">' + escapeHtml(String(p.length)) + ' × ' + escapeHtml(String(p.width)) + ' mm</span>' +
                '<div class="settings-plate-header-actions">' +
                    '<button type="button" class="settings-item-edit" onclick="editKappePlate(' + idx + ')" title="' + t('edit_btn') + '">' + editIcon + '</button>' +
                    '<button type="button" class="settings-item-remove" onclick="removeKappePlate(' + idx + ')" title="' + t('delete_btn') + '"' + (canDelete ? '' : ' disabled') + '>' + deleteIcon + '</button>' +
                '</div>' +
            '</div>' +
            '<div class="settings-plate-products">' +
                '<span class="settings-plate-products-label">' + t('kappe_settings_plate_used_by') + '</span>' +
                tagsHtml +
                emptyHint +
                assignBtn +
            '</div>' +
        '</div>';
    }).join('');
}

function addKappePlate() {
    var lenEl = document.getElementById('settings-new-plate-length');
    var widEl = document.getElementById('settings-new-plate-width');
    if (!lenEl || !widEl) return;
    var L = parseFloat(String(lenEl.value || '').replace(',', '.'));
    var W = parseFloat(String(widEl.value || '').replace(',', '.'));
    if (!L || L <= 0 || !W || W <= 0) {
        showNotificationModal('Fyll inn både lengde og bredde i mm.');
        return;
    }
    var plates = (getKappeCatalog().plates || []).slice();
    if (plates.some(function(p) { return p.length === L && p.width === W; })) {
        showNotificationModal('Plate ' + L + ' × ' + W + ' mm finnes allerede.');
        return;
    }
    plates.push({ length: L, width: W, productNames: [] });
    _saveKappePlates(plates);
    lenEl.value = '';
    widEl.value = '';
    renderKappePlateSettings();
}

function editKappePlate(idx) {
    var plates = (getKappeCatalog().plates || []).slice();
    var p = plates[idx];
    if (!p) return;
    var container = document.getElementById('settings-kappe-plate-items');
    var item = container ? container.children[idx] : null;
    var dimSpan = item ? item.querySelector('.settings-plate-dim') : null;
    if (!dimSpan) return;
    var oldText = dimSpan.textContent;
    var wrapper = document.createElement('span');
    wrapper.className = 'settings-plate-dim';
    var lenInput = document.createElement('input');
    lenInput.type = 'text';
    lenInput.className = 'settings-list-edit-input settings-plate-edit-input';
    lenInput.inputMode = 'numeric';
    lenInput.value = String(p.length);
    var xSpan = document.createElement('span');
    xSpan.className = 'settings-plate-x';
    xSpan.textContent = ' × ';
    var widInput = document.createElement('input');
    widInput.type = 'text';
    widInput.className = 'settings-list-edit-input settings-plate-edit-input';
    widInput.inputMode = 'numeric';
    widInput.value = String(p.width);
    wrapper.appendChild(lenInput);
    wrapper.appendChild(xSpan);
    wrapper.appendChild(widInput);
    dimSpan.replaceWith(wrapper);
    lenInput.focus();
    lenInput.select();
    var saved = false;
    function save() {
        if (saved) return;
        saved = true;
        var L = parseFloat(String(lenInput.value || '').replace(',', '.'));
        var W = parseFloat(String(widInput.value || '').replace(',', '.'));
        if (!L || L <= 0 || !W || W <= 0) {
            renderKappePlateSettings();
            return;
        }
        if (plates.some(function(other, i) { return i !== idx && other.length === L && other.width === W; })) {
            showNotificationModal('Plate ' + L + ' × ' + W + ' mm finnes allerede.');
            renderKappePlateSettings();
            return;
        }
        plates[idx].length = L;
        plates[idx].width = W;
        _saveKappePlates(plates);
        renderKappePlateSettings();
    }
    function commitOnBlur(e) {
        // Bare lagre når begge inputs har mistet fokus
        setTimeout(function() {
            if (document.activeElement !== lenInput && document.activeElement !== widInput) save();
        }, 0);
    }
    lenInput.addEventListener('blur', commitOnBlur);
    widInput.addEventListener('blur', commitOnBlur);
    lenInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); widInput.focus(); widInput.select(); }
        if (e.key === 'Escape') { saved = true; renderKappePlateSettings(); }
    });
    widInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); widInput.blur(); }
        if (e.key === 'Escape') { saved = true; renderKappePlateSettings(); }
    });
}

function removeKappePlate(idx) {
    var plates = (getKappeCatalog().plates || []).slice();
    var p = plates[idx];
    if (!p) return;
    if (idx === 0 && plates.length === 1) {
        showNotificationModal('Kan ikke slette siste plate — minst én plate kreves som fallback.');
        return;
    }
    showConfirmModal('Slette plate ' + p.length + ' × ' + p.width + ' mm?', function() {
        plates.splice(idx, 1);
        _saveKappePlates(plates);
        renderKappePlateSettings();
    }, t('btn_remove'), '#e74c3c');
}

function unassignKappePlateProduct(plateIdx, productIdx) {
    var plates = (getKappeCatalog().plates || []).slice();
    if (!plates[plateIdx]) return;
    var pn = (plates[plateIdx].productNames || []).slice();
    if (productIdx < 0 || productIdx >= pn.length) return;
    pn.splice(productIdx, 1);
    plates[plateIdx].productNames = pn;
    _saveKappePlates(plates);
    renderKappePlateSettings();
}

// Modal for å tildele produkter til en plate (multi-select med checkboxes).
var _kappePlateAssignIdx = -1;

function openKappePlateAssignModal(plateIdx) {
    var plates = getKappeCatalog().plates || [];
    if (!plates[plateIdx]) return;
    _kappePlateAssignIdx = plateIdx;
    var isolationProducts = getKappeProducts();
    var currentAssigned = (plates[plateIdx].productNames || []).map(function(n) { return n.toLowerCase(); });
    // For hvert produkt: vis hvilken plate det er tildelt (hvis noen), og om denne er valgt
    var html = isolationProducts.map(function(prod) {
        var lc = prod.name.toLowerCase();
        var isChecked = currentAssigned.indexOf(lc) !== -1;
        // Hvilken annen plate er produktet tildelt (informasjons-tekst)
        var otherPlateDim = '';
        if (!isChecked) {
            for (var i = 0; i < plates.length; i++) {
                if (i === plateIdx) continue;
                if ((plates[i].productNames || []).some(function(n) { return n.toLowerCase() === lc; })) {
                    otherPlateDim = ' <span class="settings-plate-assign-hint">(nå: ' + plates[i].length + '×' + plates[i].width + ')</span>';
                    break;
                }
            }
        }
        return '<label class="settings-plate-assign-row">' +
            '<input type="checkbox" class="settings-plate-assign-checkbox" data-product="' + escapeHtml(prod.name) + '"' + (isChecked ? ' checked' : '') + '>' +
            '<span class="settings-plate-assign-name">' + escapeHtml(prod.name) + otherPlateDim + '</span>' +
        '</label>';
    }).join('');
    var bodyEl = document.getElementById('kappe-plate-assign-body');
    if (bodyEl) bodyEl.innerHTML = html || '<div style="color:#999;padding:8px;">Ingen isolasjons-produkter</div>';
    var titleEl = document.getElementById('kappe-plate-assign-title');
    if (titleEl) titleEl.textContent = t('kappe_settings_plate_assign_title') + ' · ' + plates[plateIdx].length + '×' + plates[plateIdx].width + ' mm';
    document.getElementById('kappe-plate-assign-modal').classList.add('active');
}

function closeKappePlateAssignModal() {
    document.getElementById('kappe-plate-assign-modal').classList.remove('active');
    _kappePlateAssignIdx = -1;
}

function saveKappePlateAssign() {
    if (_kappePlateAssignIdx < 0) { closeKappePlateAssignModal(); return; }
    var plates = (getKappeCatalog().plates || []).slice();
    var target = plates[_kappePlateAssignIdx];
    if (!target) { closeKappePlateAssignModal(); return; }
    var checkboxes = document.querySelectorAll('#kappe-plate-assign-body .settings-plate-assign-checkbox');
    var newAssigned = [];
    checkboxes.forEach(function(cb) {
        if (cb.checked) newAssigned.push(cb.getAttribute('data-product'));
    });
    target.productNames = newAssigned;
    // Fjern disse produktene fra ANDRE plater (én plate per produkt).
    var assignedLc = newAssigned.map(function(n) { return n.toLowerCase(); });
    plates.forEach(function(p, i) {
        if (i === _kappePlateAssignIdx) return;
        p.productNames = (p.productNames || []).filter(function(n) {
            return assignedLc.indexOf(n.toLowerCase()) === -1;
        });
    });
    _saveKappePlates(plates);
    closeKappePlateAssignModal();
    renderKappePlateSettings();
}

function renderKappeProductSettings() {
    var brandContainer = document.getElementById('settings-kappe-brand-items');
    var dimContainer = document.getElementById('settings-kappe-dim-items');
    if (!brandContainer || !dimContainer) return;

    var expandedSet = new Set();
    brandContainer.querySelectorAll('.kappe-product-settings-group.expanded').forEach(function(el) {
        var name = el.querySelector('.settings-kappe-product-name-display');
        if (name) expandedSet.add(name.textContent);
    });
    var products = getKappeCatalogProducts();
    var dimensions = getKappeDimensions().slice();
    _sortKappeNumeric(dimensions);

    var brandCount = document.getElementById('settings-count-kappe-brands');
    if (brandCount) brandCount.textContent = products.length ? '(' + products.length + ')' : '';
    var dimCount = document.getElementById('settings-count-kappe-dimensions');
    if (dimCount) dimCount.textContent = dimensions.length ? '(' + dimensions.length + ')' : '';

    brandContainer.innerHTML = products.map(function(p, i) {
        var html = _kappeProductSettingsItemHtml(p, i);
        if (expandedSet.has(p.name)) {
            html = html.replace('kappe-product-settings-group', 'kappe-product-settings-group expanded');
        }
        return html;
    }).join('');

    dimContainer.innerHTML = dimensions.map(function(d, i) {
        return _kappeSettingsItemHtml(d, i, 'editGlobalKappeDimension', 'removeGlobalKappeDimension');
    }).join('');
}

function addKappeProduct() {
    var nameEl = document.getElementById('settings-new-kappe-brand');
    if (!nameEl) return;
    var name = (nameEl.value || '').trim();
    if (!name) { showNotificationModal(t('kappe_settings_name_required')); nameEl.focus(); return; }
    var typeEl = document.getElementById('settings-new-kappe-type');
    var type = typeEl && typeEl.value === 'festemiddel' ? 'festemiddel' : 'isolasjon';
    // Enheter er ikke lenger brukervalgbart — låses av popup-modus per ordrelinje.
    // Lagrer fortsatt type-relevante defaults for bakoverkompatibilitet med eksisterende lese-kode.
    var units = type === 'festemiddel' ? ['stk', 'eske'] : ['meter', 'stk'];
    var products = getKappeCatalogProducts();
    if (products.some(function(p) { return p.name.toLowerCase() === name.toLowerCase(); })) {
        showNotificationModal(t('kappe_settings_duplicate'));
        return;
    }
    products.push({ name: name, type: type, units: units, defaultUnit: units[0], usesDimensions: true });
    _saveKappeProducts(products, getKappeDimensions());
    nameEl.value = '';
    renderKappeProductSettings();
}

function editKappeProduct(idx) {
    var products = getKappeCatalogProducts();
    var p = products[idx];
    if (!p) return;
    var container = document.getElementById('settings-kappe-brand-items');
    var item = container ? container.children[idx] : null;
    var span = item ? item.querySelector('.settings-kappe-product-name-display') : null;
    if (!span) return;
    var oldName = p.name;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = oldName;
    input.onclick = function(e) { e.stopPropagation(); };
    span.replaceWith(input);
    input.focus();
    input.select();
    var saved = false;

    function save() {
        if (saved) return;
        saved = true;
        var newName = input.value.trim();
        if (!newName || newName === oldName) {
            renderKappeProductSettings();
            return;
        }
        if (products.some(function(other, i) { return i !== idx && other.name.toLowerCase() === newName.toLowerCase(); })) {
            showNotificationModal(t('kappe_settings_duplicate'));
            renderKappeProductSettings();
            return;
        }
        products[idx].name = newName;
        _saveKappeProducts(products, getKappeDimensions());
        renderKappeProductSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderKappeProductSettings(); }
    });
}

function changeKappeProductType(idx, type) {
    var products = getKappeCatalogProducts();
    var p = products[idx];
    if (!p) return;
    var newType = type === 'festemiddel' ? 'festemiddel' : 'isolasjon';
    p.type = newType;
    if (!Array.isArray(p.units)) p.units = [];
    if (p.units.length && (!p.defaultUnit || !p.units.some(function(unit) { return unit.toLowerCase() === String(p.defaultUnit).toLowerCase(); }))) {
        p.defaultUnit = p.units[0];
    } else if (!p.units.length) {
        p.defaultUnit = '';
    }
    _saveKappeProducts(products, getKappeDimensions());
    renderKappeProductSettings();
}

function setDefaultKappeProductUnit(idx, unitIdx) {
    var products = getKappeCatalogProducts();
    var p = products[idx];
    if (!p || !p.units || !p.units[unitIdx]) return;
    p.defaultUnit = p.units[unitIdx];
    _saveKappeProducts(products, getKappeDimensions());
    renderKappeProductSettings();
}

function addKappeProductUnit(idx) {
    var products = getKappeCatalogProducts();
    var p = products[idx];
    if (!p) return;
    var container = document.getElementById('settings-kappe-brand-items');
    var group = container ? container.children[idx] : null;
    if (!group) return;
    group.classList.add('expanded');
    if (group.querySelector('.settings-material-unit-edit')) return;
    var addRow = group.querySelector('.settings-material-unit-add');
    if (!addRow) return;

    var editRow = document.createElement('div');
    editRow.className = 'settings-material-unit-edit';
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enhet';
    input.autocapitalize = 'off';
    var okBtn = document.createElement('button');
    okBtn.className = 'settings-unit-save settings-unit-save-ok';
    okBtn.textContent = 'OK';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-unit-save settings-unit-cancel';
    cancelBtn.textContent = '✕';
    editRow.appendChild(input);
    editRow.appendChild(okBtn);
    editRow.appendChild(cancelBtn);
    addRow.before(editRow);
    addRow.style.display = 'none';
    input.focus();
    editRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    function save() {
        var unit = input.value.trim();
        if (!unit) { renderKappeProductSettings(); return; }
        if (!p.units) p.units = [];
        if (p.units.some(function(existing) { return existing.toLowerCase() === unit.toLowerCase(); })) {
            showNotificationModal(t('kappe_settings_duplicate'));
            renderKappeProductSettings();
            return;
        }
        p.units.push(unit);
        if (!p.defaultUnit) p.defaultUnit = unit;
        _saveKappeProducts(products, getKappeDimensions());
        renderKappeProductSettings();
    }
    function cancel() { renderKappeProductSettings(); }
    okBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cancel(); }
    });
}

function editKappeProductUnit(idx, unitIdx, itemEl) {
    var products = getKappeCatalogProducts();
    var p = products[idx];
    if (!p || !p.units || !p.units[unitIdx]) return;
    var oldUnit = p.units[unitIdx];
    var editRow = document.createElement('div');
    editRow.className = 'settings-material-unit-edit';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = oldUnit;
    input.placeholder = 'Enhet';
    var okBtn = document.createElement('button');
    okBtn.className = 'settings-unit-save settings-unit-save-ok';
    okBtn.textContent = 'OK';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-unit-save settings-unit-cancel';
    cancelBtn.textContent = '✕';
    editRow.appendChild(input);
    editRow.appendChild(okBtn);
    editRow.appendChild(cancelBtn);
    itemEl.closest('.settings-material-unit-item').replaceWith(editRow);
    input.focus();
    input.select();

    function save() {
        var unit = input.value.trim();
        if (!unit) { renderKappeProductSettings(); return; }
        if (p.units.some(function(existing, i) { return i !== unitIdx && existing.toLowerCase() === unit.toLowerCase(); })) {
            showNotificationModal(t('kappe_settings_duplicate'));
            renderKappeProductSettings();
            return;
        }
        p.units[unitIdx] = unit;
        if (p.defaultUnit === oldUnit) p.defaultUnit = unit;
        _saveKappeProducts(products, getKappeDimensions());
        renderKappeProductSettings();
    }
    function cancel() { renderKappeProductSettings(); }
    okBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cancel(); }
    });
}

function removeKappeProductUnit(idx, unitIdx) {
    var products = getKappeCatalogProducts();
    var p = products[idx];
    if (!p || !p.units || !p.units[unitIdx]) return;
    var removed = p.units[unitIdx];
    p.units.splice(unitIdx, 1);
    if (p.defaultUnit === removed) p.defaultUnit = p.units[0] || '';
    _saveKappeProducts(products, getKappeDimensions());
    renderKappeProductSettings();
}

function removeKappeProduct(idx) {
    var products = getKappeCatalogProducts();
    var p = products[idx];
    if (!p) return;
    showConfirmModal(t('kappe_settings_remove_confirm') + ' "' + p.name + '"?', function() {
        products.splice(idx, 1);
        _saveKappeProducts(products, getKappeDimensions());
        renderKappeProductSettings();
    }, t('btn_remove'), '#e74c3c');
}

function addGlobalKappeDimension() {
    var inputEl = document.getElementById('settings-new-kappe-dim');
    if (!inputEl) return;
    var dim = (inputEl.value || '').trim();
    if (!dim) { showNotificationModal(t('kappe_settings_dimension_required')); inputEl.focus(); return; }
    // Strip "mm" om bruker har skrevet det
    dim = dim.replace(/mm$/i, '').trim();
    if (!dim) { showNotificationModal(t('kappe_settings_dimension_required')); inputEl.focus(); return; }
    var dimensions = getKappeDimensions();
    if (dimensions.some(function(d) { return d.toLowerCase() === dim.toLowerCase(); })) {
        showNotificationModal(t('kappe_settings_dimension_duplicate'));
        return;
    }
    dimensions.push(dim);
    _sortKappeNumeric(dimensions);
    _saveKappeProducts(getKappeCatalogProducts(), dimensions);
    inputEl.value = '';
    renderKappeProductSettings();
}

function editGlobalKappeDimension(idx) {
    var dimensions = getKappeDimensions().slice();
    _sortKappeNumeric(dimensions);
    var cur = dimensions[idx];
    if (cur === undefined) return;
    var container = document.getElementById('settings-kappe-dim-items');
    var item = container ? container.children[idx] : null;
    var span = item ? item.querySelector('.settings-list-item-name') : null;
    if (!span) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = cur;
    input.inputMode = 'numeric';
    input.onclick = function(e) { e.stopPropagation(); };
    span.replaceWith(input);
    input.focus();
    input.select();
    var saved = false;

    function save() {
        if (saved) return;
        saved = true;
        var newDim = (input.value || '').trim().replace(/mm$/i, '').trim();
        if (!newDim || newDim === cur) {
            renderKappeProductSettings();
            return;
        }
        if (dimensions.some(function(d) { return d !== cur && d.toLowerCase() === newDim.toLowerCase(); })) {
            showNotificationModal(t('kappe_settings_dimension_duplicate'));
            renderKappeProductSettings();
            return;
        }
        dimensions[idx] = newDim;
        _sortKappeNumeric(dimensions);
        _saveKappeProducts(getKappeCatalogProducts(), dimensions);
        renderKappeProductSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderKappeProductSettings(); }
    });
}

function removeGlobalKappeDimension(idx) {
    var dimensions = getKappeDimensions().slice();
    _sortKappeNumeric(dimensions);
    var dim = dimensions[idx];
    if (dim === undefined) return;
    showConfirmModal(t('kappe_settings_remove_confirm') + ' "' + _formatDimMm(dim) + '"?', function() {
        dimensions.splice(idx, 1);
        _saveKappeProducts(getKappeCatalogProducts(), dimensions);
        renderKappeProductSettings();
    }, t('btn_remove'), '#e74c3c');
}


// Felles hjelper: lagre kappe-innstilling både lokalt og til Firebase
function _syncKappeSetting(localKey, fbDoc, data) {
    safeSetItem(localKey, JSON.stringify(data));
    enqueueUserDocSet('settings', fbDoc, data, 'Sync ' + fbDoc);
}

function _loadKappeKerfSetting() {
    var el = document.getElementById('settings-kappe-kerf');
    if (!el) return;
    el.value = getKappeKerf();
    el.addEventListener('change', function() {
        var v = parseFloat(el.value.replace(',', '.'));
        if (isNaN(v) || v < 0) v = KAPPE_DEFAULT_KERF;
        el.value = v;
        _syncKappeSetting(KAPPE_KERF_KEY, 'kappe_kerf', { kerf: v });
    });
}

function _loadKappePlateSetting() {
    var elL = document.getElementById('settings-kappe-plate-lengde');
    var elB = document.getElementById('settings-kappe-plate-bredde');
    if (!elL || !elB) return;
    var plate = getKappePlate();
    elL.value = plate.lengde;
    elB.value = plate.bredde;
    function save() {
        var l = parseInt(elL.value, 10);
        var b = parseInt(elB.value, 10);
        if (isNaN(l) || l <= 0) l = KAPPE_DEFAULT_PLATE.lengde;
        if (isNaN(b) || b <= 0) b = KAPPE_DEFAULT_PLATE.bredde;
        elL.value = l;
        elB.value = b;
        _syncKappeSetting(KAPPE_PLATE_KEY, 'kappe_plate', { lengde: l, bredde: b });
    }
    elL.addEventListener('change', save);
    elB.addEventListener('change', save);
}

var _minInfoInitialized = false;

function _saveMinInfo() {
    var data = {};
    MIN_INFO_FIELDS.forEach(function(f) {
        var el = document.getElementById('mininfo-' + f);
        if (el) data[f] = el.value.trim();
    });
    var fornavnEl = document.getElementById('mininfo-fornavn');
    var etternavnEl = document.getElementById('mininfo-etternavn');
    if (fornavnEl) data.fornavn = fornavnEl.value.trim();
    if (etternavnEl) data.etternavn = etternavnEl.value.trim();
    if (fornavnEl || etternavnEl) {
        data.montor = (data.fornavn || '').trim();
    }
    MIN_INFO_TOGGLES.forEach(function(k) {
        var cb = document.getElementById('mininfo-autofill-' + k);
        if (cb) data['autofill_' + k] = cb.checked;
    });
    safeSetItem(MIN_INFO_KEY, JSON.stringify(data));
    enqueueUserDocSet('settings', 'min_info', data, 'Save min_info');
}

function _splitNameFromMontor(info) {
    if ((info.fornavn === undefined || info.fornavn === '') && (info.etternavn === undefined || info.etternavn === '') && info.montor) {
        var parts = info.montor.trim().split(/\s+/);
        info.fornavn = parts.shift() || '';
        info.etternavn = parts.join(' ');
    }
    return info;
}

function _populateNameInputs(info) {
    var fornavnEl = document.getElementById('mininfo-fornavn');
    var etternavnEl = document.getElementById('mininfo-etternavn');
    if (fornavnEl) fornavnEl.value = info.fornavn || '';
    if (etternavnEl) etternavnEl.value = info.etternavn || '';
}

function _loadMinInfoSettings() {
    var info = getMinInfo();
    // One-time cleanup: merge legacy bestiller into montor if montor is empty
    if (info.bestiller && !info.montor) {
        info.montor = info.bestiller;
        delete info.bestiller;
        delete info.autofill_bestiller;
        safeSetItem(MIN_INFO_KEY, JSON.stringify(info));
    } else if (info.bestiller !== undefined) {
        delete info.bestiller;
        delete info.autofill_bestiller;
        safeSetItem(MIN_INFO_KEY, JSON.stringify(info));
    }
    _splitNameFromMontor(info);
    MIN_INFO_FIELDS.forEach(function(f) {
        var el = document.getElementById('mininfo-' + f);
        if (el) el.value = info[f] || '';
    });
    _populateNameInputs(info);
    MIN_INFO_TOGGLES.forEach(function(k) {
        var cb = document.getElementById('mininfo-autofill-' + k);
        if (cb) cb.checked = info['autofill_' + k] !== false;
        _updateMinInfoInputState(k);
    });
    if (_minInfoInitialized) return;
    _minInfoInitialized = true;
    // Dirty-check: bare lagre + vis suksess-toast hvis verdien faktisk
    // endret seg mellom focus og blur. Uten dette utløser et hvilket som
    // helst tap-inn-tap-ut (f.eks. etter tastatur-åpning/-lukking uten
    // skriving) en feilaktig "Lagret"-toast. Site-wide mønster.
    function _attachDirtyBlurSave(el) {
        if (!el) return;
        var _initialValue = '';
        el.addEventListener('focus', function() { _initialValue = el.value; });
        el.addEventListener('blur', function() {
            if (el.value === _initialValue) return;
            _saveMinInfo();
            showNotificationModal(t('settings_defaults_saved'), true);
        });
    }
    MIN_INFO_FIELDS.forEach(function(f) {
        _attachDirtyBlurSave(document.getElementById('mininfo-' + f));
    });
    ['fornavn', 'etternavn'].forEach(function(f) {
        _attachDirtyBlurSave(document.getElementById('mininfo-' + f));
    });
    MIN_INFO_TOGGLES.forEach(function(k) {
        var cb = document.getElementById('mininfo-autofill-' + k);
        if (cb) cb.addEventListener('change', function() {
            _updateMinInfoInputState(k);
            _saveMinInfo();
        });
    });
    // Background: refresh from Firebase if available
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc('min_info').get().then(function(doc) {
            if (!doc.exists) return;
            var fresh = doc.data() || {};
            safeSetItem(MIN_INFO_KEY, JSON.stringify(fresh));
            if (document.body.classList.contains('settings-modal-open')
                && document.getElementById('settings-page-min-info').style.display !== 'none') {
                _splitNameFromMontor(fresh);
                MIN_INFO_FIELDS.forEach(function(f) {
                    var el = document.getElementById('mininfo-' + f);
                    if (el) el.value = fresh[f] || '';
                });
                _populateNameInputs(fresh);
                MIN_INFO_TOGGLES.forEach(function(k) {
                    var cb = document.getElementById('mininfo-autofill-' + k);
                    if (cb) cb.checked = fresh['autofill_' + k] !== false;
                    _updateMinInfoInputState(k);
                });
            }
        }).catch(function(){});
    }
}

function _updateMinInfoInputState(key) {
    var cb = document.getElementById('mininfo-autofill-' + key);
    if (!cb) return;
    if (key === 'montor') {
        var fornavnEl = document.getElementById('mininfo-fornavn');
        var etternavnEl = document.getElementById('mininfo-etternavn');
        if (fornavnEl) fornavnEl.disabled = !cb.checked;
        if (etternavnEl) etternavnEl.disabled = !cb.checked;
        return;
    }
    var input = document.getElementById('mininfo-' + key);
    if (input) input.disabled = !cb.checked;
}

var _serviceDefaultsInitialized = false;
function _loadServiceDefaults() {
    var info = getMinInfo();
    ['uke', 'dato'].forEach(function(k) {
        var cb = document.getElementById('service-autofill-' + k);
        if (cb) cb.checked = info['autofill_' + k] !== false;
    });
    if (_serviceDefaultsInitialized) return;
    _serviceDefaultsInitialized = true;
    ['uke', 'dato'].forEach(function(k) {
        var cb = document.getElementById('service-autofill-' + k);
        if (!cb) return;
        cb.addEventListener('change', function() {
            var data = getMinInfo();
            data['autofill_' + k] = cb.checked;
            safeSetItem(MIN_INFO_KEY, JSON.stringify(data));
            enqueueUserDocSet('settings', 'min_info', data, 'Save min_info');
            var mirror = document.getElementById('mininfo-autofill-' + k);
            if (mirror) mirror.checked = cb.checked;
        });
    });
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc('min_info').get().then(function(doc) {
            if (!doc.exists) return;
            var fresh = doc.data() || {};
            safeSetItem(MIN_INFO_KEY, JSON.stringify(fresh));
            if (document.body.classList.contains('settings-modal-open')
                && document.getElementById('settings-page-form-service').style.display !== 'none') {
                ['uke', 'dato'].forEach(function(k) {
                    var cb = document.getElementById('service-autofill-' + k);
                    if (cb) cb.checked = fresh['autofill_' + k] !== false;
                });
            }
        }).catch(function(){});
    }
}
