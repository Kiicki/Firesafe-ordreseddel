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
var _pendingFirestoreOps = Promise.resolve();

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
            if (document.body.classList.contains('template-modal-open')) {
                var activeTemplates = result.forms.filter(function(t) { return t.active !== false; });
                renderTemplateList(activeTemplates, false, _templateHasMore);
            }
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
    // When switching views, ensure toolbar is back at body-level (fixed bottom).
    // Keyboard-open reparenting is handled by visualViewport.resize.
    var _tb = document.querySelector('.toolbar');
    if (_tb && _tb.parentNode !== document.body) {
        document.body.appendChild(_tb);
        _tb.classList.remove('toolbar--inflow');
    }
}

function closeAllModals() {
    var actionPopup = document.getElementById('action-popup');
    if (actionPopup) actionPopup.classList.remove('active');
    _bilHistoryRendered = false;
    document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'service-view-open', 'kappe-view-open', 'calculator-modal-open');
    sessionStorage.removeItem('firesafe_settings_page');
    sessionStorage.removeItem('firesafe_form_type');
    sessionStorage.removeItem('firesafe_hent_tab');
    sessionStorage.removeItem('firesafe_defaults_tab');
    sessionStorage.removeItem('firesafe_service_current');
    sessionStorage.removeItem('firesafe_kappe_current');
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

    // Signering-dato er alltid disabled (system-styrt, uavhengig av read-only-status)
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

function loadForm(index) {
    if (window.loadedForms[index]) {
        loadFormDirect(window.loadedForms[index]);
    }
}

function loadFormDirect(formData) {
    if (!formData) return;
    setFormData(formData);

    // Regel: alltid dagens dato, unntatt for sendte skjema (bevar historisk).
    if (!formData._isSent) _setSigneringDatoToday();

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
    window.scrollTo(0, 0);
}

async function duplicateForm(event, index) {
    if (event) event.stopPropagation();
    const form = window.loadedForms[index];
    if (!form) return;
    showConfirmModal(t('duplicate_confirm'), function() {
        duplicateFormDirect(form);
    }, t('duplicate_btn'));
}

async function duplicateFormDirect(form) {
    if (!form) return;

    setFormData(form);
    // Tøm ordrenummer og sett nytt
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    autoFillOrderNumber();

    // Sett uke basert på autofyll-innstillinger; signering-dato alltid dagens
    const now = new Date();
    const flags = getAutofillFlags();
    if (flags.uke) {
        const week = 'Uke ' + getWeekNumber(now);
        document.getElementById('dato').value = week;
        document.getElementById('mobile-dato').value = week;
    }
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
    window.scrollTo(0, 0);
    showNotificationModal(t('duplicated_success'), true);
}

function deleteForm(event, index) {
    if (event) event.stopPropagation();
    const form = window.loadedForms[index];
    if (!form) return;
    deleteFormDirect(form);
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

        // Firebase in background (serialized)
        if (currentUser && db) {
            var docId = form.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return db.collection('users').doc(currentUser.uid).collection(col).doc(docId).delete();
            }).catch(function(e) { console.error('Delete error:', e); });
        }
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
    sessionStorage.setItem('firesafe_hent_tab', tab);
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const serviceList = document.getElementById('service-list');
    const kappeList = document.getElementById('kappe-list');
    const ownSearch = document.getElementById('own-search-wrap');
    const serviceSearch = document.getElementById('service-search-wrap');
    const kappeSearch = document.getElementById('kappe-search-wrap');

    savedList.style.display = 'none';
    serviceList.style.display = 'none';
    if (kappeList) kappeList.style.display = 'none';
    ownSearch.style.display = 'none';
    serviceSearch.style.display = 'none';
    if (kappeSearch) kappeSearch.style.display = 'none';

    if (tab === 'own') {
        tabs[0].classList.add('active');
        savedList.style.display = '';
        ownSearch.style.display = '';
        savedList.scrollTop = 0;
    } else if (tab === 'service') {
        tabs[1].classList.add('active');
        serviceList.style.display = '';
        serviceSearch.style.display = '';
        serviceList.scrollTop = 0;
        loadServiceTab();
    } else if (tab === 'kappe') {
        if (tabs[2]) tabs[2].classList.add('active');
        if (kappeList) { kappeList.style.display = ''; kappeList.scrollTop = 0; }
        if (kappeSearch) kappeSearch.style.display = '';
        loadKappeTab();
    }
}

// Action popup
function showItemMenu(event, type, index, isSent) {
    event.stopPropagation();
    var actions = [];
    var title = '';
    if (type === 'form') {
        var form = window.loadedForms[index];
        if (form) title = form.ordreseddelNr || '';
        if (isSent) {
            actions.push({ label: t('sent_banner_move'), onclick: 'moveToSaved(null, ' + index + ')' });
        } else {
            actions.push({ label: t('duplicate_btn'), onclick: 'duplicateForm(null, ' + index + ')' });
        }
        actions.push({ label: t('delete_btn'), onclick: 'deleteForm(null, ' + index + ')', disabled: isSent });
    } else if (type === 'template') {
        var tmpl = window.loadedTemplates[index];
        if (tmpl) {
            title = [tmpl.prosjektnavn, tmpl.oppdragsgiver, tmpl.prosjektnr].filter(function(x) { return x; }).join(' • ');
        }
        actions.push({ label: t('duplicate_btn'), onclick: 'duplicateTemplate(' + index + ')' });
        actions.push({ label: t('delete_btn'), onclick: 'deleteTemplate(null, ' + index + ')' });
    }
    showActionPopup(title, actions);
}

function showActionPopup(title, actions) {
    const popup = document.getElementById('action-popup');
    var titleEl = document.getElementById('action-popup-title');
    titleEl.textContent = title;
    titleEl.style.display = title ? '' : 'none';
    const buttonsEl = document.getElementById('action-popup-buttons');
    buttonsEl.innerHTML = actions.map((a, i) =>
        `<div class="confirm-modal-buttons"${i > 0 ? ' style="margin-top:8px"' : ''}><button class="confirm-btn-ok" style="background:#333;flex:1${a.disabled ? ';opacity:0.4;pointer-events:none' : ''}" onclick="${a.onclick}; closeActionPopup()"${a.disabled ? ' disabled' : ''}>${a.label}</button></div>`
    ).join('') +
    '<div class="confirm-modal-buttons" style="margin-top:4px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    popup.classList.add('active');
}

function closeActionPopup(e) {
    if (e && e.target !== document.getElementById('action-popup')) return;
    document.getElementById('action-popup').classList.remove('active');
}

function showSaveMenu() {
    if (isModalOpen()) return;
    saveForm();
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
    // From Skjemaer: close and go to form
    if (currentId === 'saved-modal') {
        if (_selectMode) toggleSelectMode();
        closeModal();
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
    var scale = Math.min(availWidth / 800, 1);

    var header = document.querySelector('.preview-overlay-header');

    // Center via block-level margin auto. Requires explicit width (800px set elsewhere)
    // and preview-scroll as a block container (not flex).
    fc.style.marginLeft = 'auto';
    fc.style.marginRight = 'auto';

    if (scale < 1) {
        fc.style.transformOrigin = 'top center';
        fc.style.transform = 'scale(' + scale + ')';
        fc.style.marginBottom = (-(fc.offsetHeight * (1 - scale))) + 'px';
        if (header) {
            header.style.maxWidth = (fc.offsetWidth * scale) + 'px';
        }
    } else {
        fc.style.transform = '';
        fc.style.transformOrigin = '';
        if (header) {
            header.style.maxWidth = '';
        }
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
    document.getElementById('preview-overlay').classList.add('active');

    // Hide body scroll so form page scrollbar doesn't show behind overlay
    document.body.style.overflow = 'hidden';

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

    // Recalculate on browser zoom / window resize / device rotation
    window._previewResizeHandler = updatePreviewScale;
    window.addEventListener('resize', window._previewResizeHandler);
    // On orientationchange, wait for viewport to settle before recalculating
    window._previewOrientHandler = function() { setTimeout(updatePreviewScale, 200); };
    window.addEventListener('orientationchange', window._previewOrientHandler);
}

function closePreview() {
    // Remove resize listener
    if (window._previewResizeHandler) {
        window.removeEventListener('resize', window._previewResizeHandler);
        window._previewResizeHandler = null;
    }
    if (window._previewOrientHandler) {
        window.removeEventListener('orientationchange', window._previewOrientHandler);
        window._previewOrientHandler = null;
    }
    if (window._svcPreviewOrientTimer) {
        clearTimeout(window._svcPreviewOrientTimer);
        window._svcPreviewOrientTimer = null;
    }

    cleanupPreviewPinchZoom();
    document.getElementById('preview-overlay').classList.remove('active');

    // Restore body scroll
    document.body.style.overflow = '';

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
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doSharePDF(); closeActionPopup()">' + shareIcon + ' PDF</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PDF</button>';
    var shareBtnPNG = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doSharePNG(); closeActionPopup()">' + shareIcon + ' PNG</button>'
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
        } else if (listId === 'template-list') {
            if (!_templatesAll) _templatesAll = window.loadedTemplates ? window.loadedTemplates.slice() : [];
            if (!term) { var all3 = _templatesAll; _templatesAll = null; renderTemplateList(all3, false, _templateHasMore); return; }
            var filtered3 = _templatesAll.filter(function(f) {
                return (f.prosjektnavn || '').toLowerCase().startsWith(term) ||
                       (f.oppdragsgiver || '').toLowerCase().startsWith(term) ||
                       (f.prosjektnr || '').toLowerCase().startsWith(term);
            });
            renderTemplateList(filtered3);
            // Søk i Firestore etter ulastede maler
            if (_templateHasMore && currentUser && db) {
                var ver3 = ++_searchVersion;
                firestoreSearchForms(rawTerm, [
                    { name: 'templates', isSent: false }
                ], 'prosjektnavn').then(function(fsResults) {
                    if (ver3 !== _searchVersion) return;
                    var merged = mergeSearchResults(filtered3, fsResults);
                    if (merged.length > filtered3.length) {
                        renderTemplateList(merged);
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

function moveCurrentToSaved() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const formsCol = 'forms';
    const archiveCol = 'archive';

    // localStorage first (optimistic)
    var archived = safeParseJSON(ARCHIVE_KEY, []);
    var formIndex = archived.findIndex(function(f) { return f.ordreseddelNr === ordrenr; });
    var formId = (formIndex !== -1) ? archived[formIndex].id : null;
    if (formIndex !== -1) {
        var saved = safeParseJSON(STORAGE_KEY, []);
        var movedForm = archived.splice(formIndex, 1)[0];
        saved.unshift(movedForm);
        safeSetItem(ARCHIVE_KEY, JSON.stringify(archived));
        safeSetItem(STORAGE_KEY, JSON.stringify(saved));
    }

    _lastLocalSaveTs = Date.now();
    setFormReadOnly(false);
    showNotificationModal(t('move_to_saved_success'), true);

    // Firebase in background (serialized, direct doc access)
    if (currentUser && db && formId) {
        _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
            return db.collection('users').doc(currentUser.uid).collection(formsCol).doc(formId).set(movedForm);
        }).then(function() {
            return db.collection('users').doc(currentUser.uid).collection(archiveCol).doc(formId).delete();
        }).catch(function(e) { console.error('Move to saved error:', e); });
    }
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

        // Firebase: serialisert via _pendingFirestoreOps for å unngå race conditions
        if (currentUser && db) {
            var archiveRef = db.collection('users').doc(currentUser.uid).collection(archiveCollection);
            var formsRef = db.collection('users').doc(currentUser.uid).collection(formsCollection);
            var docId = data.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return archiveRef.doc(docId).set(data);
            }).then(function() {
                return formsRef.doc(docId).delete();
            }).catch(function(e) { console.error('Mark as sent Firebase error:', e); });
        }
    } catch (e) {
        console.error('Mark as sent error:', e);
    }
}

function moveToSaved(event, index) {
    if (event) event.stopPropagation();
    showConfirmModal(t('move_to_saved_confirm'), function() {
        const form = window.loadedForms[index];
        if (!form) return;

        // localStorage first (optimistic)
        const archived = safeParseJSON(ARCHIVE_KEY, []);
        const saved = safeParseJSON(STORAGE_KEY, []);
        const idx = archived.findIndex(f => f.id === form.id);
        if (idx !== -1) {
            const f = archived.splice(idx, 1)[0];
            saved.unshift(f);
            safeSetItem(ARCHIVE_KEY, JSON.stringify(archived));
            safeSetItem(STORAGE_KEY, JSON.stringify(saved));
        }

        // Hvis det åpne skjemaet er det som ble flyttet, fjern sendt-modus
        const currentOrdrenr = document.getElementById('mobile-ordreseddel-nr').value;
        if (currentOrdrenr && form.ordreseddelNr === currentOrdrenr) {
            setFormReadOnly(false);
        }

        _lastLocalSaveTs = Date.now();
        showSavedForms();
        showNotificationModal(t('move_to_saved_success'), true);

        // Firebase in background (serialized)
        if (currentUser && db) {
            var docId = form.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return db.collection('users').doc(currentUser.uid).collection('forms').doc(docId).set(form);
            }).then(function() {
                return db.collection('users').doc(currentUser.uid).collection('archive').doc(docId).delete();
            }).catch(function(e) { console.error('Restore error:', e); });
        }
    }, t('btn_move'), '#333');
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

async function saveAsTemplate() {
    // Sync mobile to original first
    if (isMobile()) {
        syncMobileToOriginal();
    }

    // Validate template required fields
    const reqSettings = cachedRequiredSettings || getDefaultRequiredSettings();
    const templateReqs = reqSettings.template || {};
    const templateFieldMap = {
        prosjektnavn:   { id: 'prosjektnavn',  key: 'validation_prosjektnavn' },
        prosjektnr:     { id: 'prosjektnr',    key: 'validation_prosjektnr' },
        oppdragsgiver:  { id: 'oppdragsgiver', key: 'validation_oppdragsgiver' },
        kundensRef:     { id: 'kundens-ref',     key: 'validation_kundens_ref' },
        fakturaadresse: { id: 'fakturaadresse',  key: 'validation_fakturaadresse' }
    };
    for (const [settingKey, fieldInfo] of Object.entries(templateFieldMap)) {
        if (!templateReqs[settingKey]) continue;
        const el = document.getElementById(fieldInfo.id);
        if (!el || !el.value.trim()) {
            showNotificationModal(t('required_field', t(fieldInfo.key)));
            return;
        }
    }

    const templateData = {
        prosjektnavn: document.getElementById('prosjektnavn').value.trim(),
        prosjektnr: document.getElementById('prosjektnr').value.trim(),
        oppdragsgiver: document.getElementById('oppdragsgiver').value.trim(),
        kundensRef: document.getElementById('kundens-ref').value.trim(),
        fakturaadresse: document.getElementById('fakturaadresse').value.trim(),
        createdAt: new Date().toISOString(),
        createdBy: currentUser ? currentUser.uid : 'local'
    };

    // Update localStorage + local state immediately (optimistic)
    templateData.id = Date.now().toString();
    const templates = safeParseJSON(TEMPLATE_KEY, []);
    templates.push(templateData);
    safeSetItem(TEMPLATE_KEY, JSON.stringify(templates));
    if (window.loadedTemplates) window.loadedTemplates.push(templateData);
    showNotificationModal(t('template_save_success'), true);

    // Firebase in background
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('templates').doc(templateData.id).set(templateData)
            .catch(function(e) { console.error('Save template error:', e); });
    }
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

function renderTemplateList(templates, append, hasMore) {
    var listEl = document.getElementById('template-list');
    if (!listEl) return;
    var existingBtn = listEl.querySelector('.load-more-btn');
    if (existingBtn) existingBtn.remove();

    if (!append) {
        if (!templates || templates.length === 0) {
            listEl.innerHTML = '<div class="no-saved">' + t('no_templates') + '</div>';
            return;
        }
        window.loadedTemplates = templates;
        listEl.innerHTML = templates.map(function(item, i) { return _buildTemplateItemHtml(item, i); }).join('');
    } else {
        var startIndex = window.loadedTemplates.length;
        window.loadedTemplates = window.loadedTemplates.concat(templates);
        var html = templates.map(function(item, i) { return _buildTemplateItemHtml(item, startIndex + i); }).join('');
        listEl.insertAdjacentHTML('beforeend', html);
    }

    listEl.querySelectorAll('.saved-item').forEach(function(el, i) {
        el._formData = window.loadedTemplates[i];
    });

    if (hasMore) {
        listEl.insertAdjacentHTML('beforeend', '<button class="load-more-btn" onclick="loadMoreTemplates()">' + t('load_more') + '</button>');
    }
}

async function loadMoreTemplates() {
    var btn = document.querySelector('#template-list .load-more-btn');
    if (btn) btn.textContent = '...';
    if (_templateHasMore && _templateLastDoc) {
        var result = await getTemplates(_templateLastDoc);
        _templateLastDoc = result.lastDoc;
        _templateHasMore = result.hasMore;
        renderTemplateList(result.forms, true, _templateHasMore);
    }
}

var _bilHistoryRendered = false;
function showTemplateModal() {
    closeAllModals();
    history.replaceState(null, '', window.location.pathname);

    showView('template-modal');
    document.body.classList.add('template-modal-open');
    updateToolbarState();
    if (!_bilHistoryRendered) {
        renderBilHistory();
        _bilHistoryRendered = true;
    }
}

function autoFillOrderNumber() {
    const nextNr = getNextOrderNumber();
    if (nextNr !== null) {
        document.getElementById('ordreseddel-nr').value = nextNr;
        document.getElementById('mobile-ordreseddel-nr').value = nextNr;
    }
}

function loadTemplate(index) {
    const template = window.loadedTemplates[index];
    if (!template) return;
    loadTemplateDirect(template);
}

function loadTemplateDirect(template) {
    if (!template) return;

    preNewFormData = null;
    clearForm();
    setFormReadOnly(false);

    // Fill defaults first, then override with template values
    autoFillDefaults();

    // Template values override defaults (only non-empty, project fields only)
    const templateFields = {
        'oppdragsgiver': template.oppdragsgiver,
        'prosjektnr': template.prosjektnr,
        'prosjektnavn': template.prosjektnavn,
        'kundens-ref': template.kundensRef,
        'fakturaadresse': template.fakturaadresse
    };
    for (const [id, val] of Object.entries(templateFields)) {
        if (val) {
            const el = document.getElementById(id);
            const mobileEl = document.getElementById('mobile-' + id);
            if (el) el.value = val;
            if (mobileEl) mobileEl.value = val;
        }
    }

    autoFillOrderNumber();
    updateFakturaadresseDisplay('fakturaadresse-display-text', template.fakturaadresse || '');

    showView('view-form');
    document.body.classList.remove('template-modal-open');
    updateToolbarState();
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_form_type', 'own');
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    lastSavedData = getFormDataSnapshot();
    document.getElementById('form-header-title').textContent = t('form_title');
    updateOrderDeleteStates();
    window.scrollTo(0, 0);
}

function deleteTemplate(event, index) {
    if (event) event.stopPropagation();
    const template = window.loadedTemplates[index];
    if (!template) return;
    deleteTemplateDirect(template);
}

function deleteTemplateDirect(template) {
    if (!template) return;
    showConfirmModal(t('template_delete_confirm'), function() {
        // Optimistic removal: update local state + DOM immediately
        var arrIdx = window.loadedTemplates.findIndex(function(t) { return t.id === template.id; });
        if (arrIdx !== -1) window.loadedTemplates.splice(arrIdx, 1);
        var lsList = safeParseJSON(TEMPLATE_KEY, []);
        var lsIdx = lsList.findIndex(function(t) { return t.id === template.id; });
        if (lsIdx !== -1) { lsList.splice(lsIdx, 1); safeSetItem(TEMPLATE_KEY, JSON.stringify(lsList)); }
        // Remove DOM element from picker if open
        document.querySelectorAll('#template-picker-list .saved-item').forEach(function(el) {
            if (el._formData && el._formData.id === template.id) el.remove();
        });

        // Firebase in background
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('templates').doc(template.id).delete()
                .catch(function(e) { console.error('Delete template error:', e); });
        }
    });
}

async function duplicateTemplate(index) {
    const template = window.loadedTemplates[index];
    if (!template) return;

    showConfirmModal(t('duplicate_confirm'), async function() {
    const copy = Object.assign({}, template);
    copy.prosjektnavn = (copy.prosjektnavn || '') + ' (kopi)';
    copy.createdAt = new Date().toISOString();

    // Update localStorage + local state immediately (optimistic)
    copy.id = Date.now().toString();
    const templates = safeParseJSON(TEMPLATE_KEY, []);
    templates.push(copy);
    safeSetItem(TEMPLATE_KEY, JSON.stringify(templates));
    if (window.loadedTemplates) window.loadedTemplates.push(copy);
    showNotificationModal(t('duplicated_success'), true);
    showTemplateModal();

    // Firebase in background
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('templates').doc(copy.id).set(copy)
            .catch(function(e) { console.error('Duplicate template error:', e); });
    }
    }, t('duplicate_btn'));
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
    if (currentUser && db) {
        try {
            const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').get();
            if (doc.exists) data = doc.data();
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
        ordrenr: t('settings_ordrenr'),
        defaults: t('settings_defaults'),
        templates: t('settings_templates'),
        required: t('settings_required'),
        language: t('settings_language'),
        materials: t('settings_materials'),
        plans: t('settings_plans'),
        'kappe-products': t('settings_kappe_products')
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
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    var pageEl2 = document.getElementById('settings-page-' + page);
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

    // Mark global settings pages as read-only for non-admins
    var pageEl = document.getElementById('settings-page-' + page);
    if ((page === 'materials' || page === 'plans') && !isAdmin) {
        pageEl.classList.add('settings-readonly');
    } else {
        pageEl.classList.remove('settings-readonly');
    }

    if (page === 'ordrenr') {
        document.getElementById('settings-new-start').value = '';
        document.getElementById('settings-new-end').value = '';
        document.getElementById('settings-give-start').value = '';
        document.getElementById('settings-give-end').value = '';
        var cachedOrdrenr = _getCachedOrderNrSettings();
        // Show cached immediately if available
        if (cachedOrdrenr) {
            _applyOrderNrSettings(cachedOrdrenr);
        }
        // Refresh from Firebase
        getOrderNrSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open'))
                _applyOrderNrSettings(settings);
        });
    } else if (page === 'defaults') {
        _defaultsTab = 'own';
        // Show cached immediately, then background refresh
        loadDefaultsForTab('own');
        initDefaultsAutoSave();
    } else if (page === 'required') {
        // Show cached immediately
        cachedRequiredSettings = _getCachedRequiredSettings();
        renderRequiredSettingsItems('save');
        renderRequiredSettingsItems('service');
        renderRequiredSettingsItems('kappe');
        // Background refresh
        getRequiredSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open')) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('save');
                renderRequiredSettingsItems('service');
                renderRequiredSettingsItems('kappe');
            }
        });
    } else if (page === 'language') {
        document.getElementById('lang-check-no').textContent = currentLang === 'no' ? '\u2713' : '';
        document.getElementById('lang-check-en').textContent = currentLang === 'en' ? '\u2713' : '';
    } else if (page === 'templates') {
        // Show cached templates immediately
        _renderSettingsTemplateListFromData(safeParseJSON(TEMPLATE_KEY, []));
        cachedRequiredSettings = _getCachedRequiredSettings();
        renderRequiredSettingsItems('template');
        // Background refresh
        renderSettingsTemplateList().then(function() {
            if (!document.body.classList.contains('settings-modal-open')) return;
            getRequiredSettings().then(function(settings) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('template');
            });
        });
    } else if (page === 'materials') {
        var cachedMat = localStorage.getItem(MATERIALS_KEY);
        var cachedData = normalizeMaterialData(cachedMat ? JSON.parse(cachedMat) : null);
        settingsMaterials = cachedData.materials.slice();
        settingsMaterials.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
        document.getElementById('settings-new-material').value = '';
        document.getElementById('settings-new-material-type').value = 'standard';
        document.getElementById('settings-new-material-variant').value = '';
        updateSettingsUnitFields();
        // Show loading if cache is empty and user is logged in (Firebase has data)
        if (settingsMaterials.length === 0 && currentUser && db) {
            document.getElementById('settings-material-items').innerHTML = '<div class="settings-loading">' + t('loading') + '</div>';
        } else {
            renderMaterialSettingsItems();
        }
        // Refresh from Firebase
        getMaterialSettings().then(function(data) {
            if (!document.body.classList.contains('settings-modal-open')) return;
            settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
            settingsMaterials.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
            renderMaterialSettingsItems();
        });
    } else if (page === 'kappe-products') {
        var newNameEl = document.getElementById('settings-new-kappe-product');
        var newStiftEl = document.getElementById('settings-new-kappe-stift');
        if (newNameEl) newNameEl.value = '';
        if (newStiftEl) newStiftEl.value = '';
        renderKappeProductSettings();
        renderKappeStiftSizeSettings();
        _loadKappeKerfSetting();
    } else if (page === 'plans') {
        var storedPlans = localStorage.getItem(PLANS_KEY);
        settingsPlans = storedPlans ? sortPlans(JSON.parse(storedPlans)) : [];
        document.getElementById('settings-new-plan').value = '';
        // Show loading if cache is empty and user is logged in
        if (settingsPlans.length === 0 && currentUser && db) {
            document.getElementById('settings-plan-items').innerHTML = '<div class="settings-loading">' + t('loading') + '</div>';
        } else {
            renderPlanSettingsItems();
        }
        // Refresh from Firebase
        getPlanSettings().then(function(plans) {
            if (!document.body.classList.contains('settings-modal-open')) return;
            settingsPlans = sortPlans(plans || []);
            renderPlanSettingsItems();
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
            return {
                name: m.name,
                type: type,
                defaultUnit: m.defaultUnit || '',
                allowedUnits: normalizeAllowedUnits(m.allowedUnits, m.defaultUnit || '')
            };
        });
    }
    return { materials, units: [] };
}

async function getMaterialSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('settings').doc('materials').get();
            if (doc.exists) return normalizeMaterialData(doc.data());
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

async function loadMaterialSettingsToModal() {
    const data = await getMaterialSettings();
    settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    renderMaterialSettingsItems();
    document.getElementById('settings-new-material').value = '';
}

function renderMaterialSettingsItems() {
    const container = document.getElementById('settings-material-items');
    if (settingsMaterials.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_materials') + '</div>';
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
            const removeBtn = `<button class="settings-material-unit-remove" onclick="event.stopPropagation();removeMaterialUnit(${idx},${ui})">&times;</button>`;
            const editBtn = `<button class="settings-material-unit-edit-btn" onclick="event.stopPropagation();editMaterialUnit(${idx},${ui},this)" title="Rediger">✏️</button>`;
            return `<div class="settings-material-unit-item">
                ${starIcon}<span class="settings-material-unit-text">${escapeHtml(label)}</span>${editBtn}${removeBtn}</div>`;
        }).join('');
        const addRow = unitLocked ? '' : `<div class="settings-material-unit-add" onclick="addMaterialUnit(${idx})">+ Legg til variant</div>`;
        const isExpanded = expandedSet.has(item.name);
        const matType = item.type || 'standard';
        const bodyContent = unitLocked ? '' : `${variantsHtml}${addRow}`;
        return `<div class="settings-material-group${isExpanded ? ' expanded' : ''}">
            <div class="settings-material-header" onclick="toggleMaterialExpand(this)">
                <span class="settings-material-name-display">${escapeHtml(item.name)}</span>
                <button class="settings-material-type-btn" onclick="event.stopPropagation();openMatTypeDropdown(this,${idx})" data-value="${matType}">${t('material_type_' + matType)}</button>
                <button class="settings-delete-btn" onclick="event.stopPropagation();removeSettingsMaterial(${idx})" title="${t('btn_remove')}">${deleteIcon}</button>
                <button class="settings-material-edit-btn" onclick="event.stopPropagation();editSettingsMaterial(${idx})" title="Rediger navn">✏️</button>
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
    const addRow = group.querySelector('[data-tab="units"] .settings-material-unit-add');
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

function setDefaultUnit(idx, unitIdx) {
    // No longer needed — kept as no-op for backward compat
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
    mat.allowedUnits.splice(unitIdx, 1);
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

function openMatTypeDropdown(btn, idx) {
    // Remove any existing dropdown
    const existing = document.querySelector('.mat-type-backdrop');
    if (existing) { closeMatTypeDropdown(); return; }

    const current = btn.dataset.value;
    const types = [
        { value: 'standard', icon: '#', desc: t('material_type_standard_desc'), lm: false },
        { value: 'mansjett', icon: '○', desc: t('material_type_mansjett_desc'), lm: true },
        { value: 'brannpakning', icon: '◎', desc: t('material_type_brannpakning_desc'), lm: true },
        { value: 'kabelhylse', icon: '⬡', desc: t('material_type_kabelhylse_desc'), lm: false }
    ];

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'mat-type-backdrop';
    backdrop.onclick = () => closeMatTypeDropdown();

    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'mat-type-dropdown';



    types.forEach(({ value, icon, desc, lm }) => {
        const isActive = value === current;
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
            if (value !== current) changeMaterialType(idx, value);
        };
        dropdown.appendChild(item);
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(dropdown);

    // Animate in
    requestAnimationFrame(() => {
        backdrop.classList.add('visible');
        dropdown.classList.add('visible');
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
            if (doc.exists) return doc.data().plans || [];
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
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_plans') + '</div>';
        return;
    }
    var html = '';
    settingsPlans.forEach(function(name, idx) {
        html += '<div class="settings-plan-item">' +
            '<span class="settings-plan-name">' + escapeHtml(name) + '</span>' +
            '<button type="button" class="settings-plan-remove" onclick="removeSettingsPlan(' + idx + ')">✕</button>' +
            '</div>';
    });
    container.innerHTML = html;
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
            fakturaadresse: false
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
            stift: false
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
        { key: 'plan',          labelKey: 'order_plan' },
        { key: 'merknad',       labelKey: 'order_merknad' },
        { key: 'materialer',    labelKey: 'order_materials_label' },
        { key: 'signatur',       labelKey: 'label_kundens_underskrift' }
    ],
    template: [
        { key: 'prosjektnavn',   labelKey: 'label_prosjektnavn' },
        { key: 'prosjektnr',     labelKey: 'label_prosjektnr' },
        { key: 'oppdragsgiver',  labelKey: 'label_oppdragsgiver' },
        { key: 'kundensRef',     labelKey: 'label_kundens_ref' },
        { key: 'fakturaadresse', labelKey: 'label_fakturaadresse' }
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
        { key: 'stift',               labelKey: 'kappe_section_staples' }
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
                return {
                    save: { ...defaults.save, ...(data.save || {}) },
                    template: { ...defaults.template, ...(data.template || {}) },
                    service: { ...defaults.service, ...(data.service || {}) },
                    kappe: { ...defaults.kappe, ...(data.kappe || {}) }
                };
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

async function loadRequiredSettingsToModal() {
    const data = await getRequiredSettings();
    cachedRequiredSettings = data;
    renderRequiredSettingsItems('save');
    renderRequiredSettingsItems('template');
    renderRequiredSettingsItems('service');
    renderRequiredSettingsItems('kappe');
}

function renderRequiredSettingsItems(section) {
    const container = document.getElementById('settings-fields-' + section + '-items');
    if (!container) return;

    const fields = REQUIRED_FIELD_LABELS[section];
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    const sectionSettings = settings[section] || {};

    container.innerHTML = fields.map(function(field) {
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
    }).join('');
}

async function toggleRequiredField(section, key, value) {
    if (!isAdmin) return;
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    if (!settings[section]) settings[section] = {};
    settings[section][key] = value;
    await saveRequiredSettings(settings);
    updateRequiredIndicators();
}

function switchRequiredTab(tab) {
    // Toggle tab active state
    var tabs = document.querySelectorAll('#settings-page-required .settings-tab');
    tabs.forEach(function(t, i) {
        t.classList.toggle('active',
            (tab === 'own' && i === 0)
            || (tab === 'service' && i === 1)
            || (tab === 'kappe' && i === 2));
    });

    // Toggle content
    var ownContent = document.getElementById('required-own-content');
    var serviceContent = document.getElementById('required-service-content');
    var kappeContent = document.getElementById('required-kappe-content');
    if (ownContent) ownContent.style.display = tab === 'own' ? '' : 'none';
    if (serviceContent) serviceContent.style.display = tab === 'service' ? '' : 'none';
    if (kappeContent) kappeContent.style.display = tab === 'kappe' ? '' : 'none';

    if (tab === 'service') renderRequiredSettingsItems('service');
    if (tab === 'kappe') renderRequiredSettingsItems('kappe');
}

// ============================================
// MAL-ADMINISTRASJON I INNSTILLINGER
// ============================================

var _editingTemplateId = null;

function _renderSettingsTemplateListFromData(templates) {
    var listEl = document.getElementById('settings-template-list');
    if (!listEl) return;

    if (!templates || templates.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_templates_settings') + '</div>';
        return;
    }

    listEl.innerHTML = templates.map(function(tpl) {
        var isActive = tpl.active !== false;
        var name = escapeHtml(tpl.prosjektnavn) || t('no_name');
        var detail = [tpl.oppdragsgiver, tpl.prosjektnr].filter(function(x) { return x; }).map(escapeHtml).join(' \u2022 ');
        var id = escapeHtml(tpl.id);

        var duplicateBtn = isActive
            ? '<button class="settings-template-duplicate-btn" onclick="event.stopPropagation(); duplicateTemplateFromSettings(\'' + id + '\')" title="' + t('duplicate_btn') + '">'
            : '<button class="settings-template-duplicate-btn disabled" onclick="event.stopPropagation()" title="' + t('duplicate_btn') + '">';
        var delBtn = isActive
            ? '<button class="settings-template-delete-btn" onclick="event.stopPropagation(); deleteTemplateFromSettings(\'' + id + '\')" title="' + t('delete_btn') + '">'
            : '<button class="settings-template-delete-btn disabled" onclick="event.stopPropagation()" title="' + t('delete_btn') + '">';

        return '<div class="settings-template-item' + (isActive ? '' : ' inactive') + '" data-id="' + id + '" onclick="showTemplateEditor(\'' + id + '\')">' +
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

var TPL_DELIVERY_FIELDS = ['mottaker', 'veiadresse', 'postnr', 'poststed', 'kontakt', 'tlf'];

function toggleTplDeliverySection(headerEl) {
    var body = document.getElementById('tpl-delivery-body');
    var arrow = document.getElementById('tpl-delivery-arrow');
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (arrow) arrow.classList.toggle('open', !open);
}

function _tplHasDeliveryData(tpl) {
    if (!tpl) return false;
    for (var i = 0; i < TPL_DELIVERY_FIELDS.length; i++) {
        if (tpl[TPL_DELIVERY_FIELDS[i]]) return true;
    }
    return false;
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
    TPL_DELIVERY_FIELDS.forEach(function(f) {
        var el = document.getElementById('tpl-edit-' + f);
        if (el) el.value = '';
    });
    // Default: leveringsadresse-seksjonen kollapset
    var deliveryBody = document.getElementById('tpl-delivery-body');
    var deliveryArrow = document.getElementById('tpl-delivery-arrow');
    if (deliveryBody) deliveryBody.style.display = 'none';
    if (deliveryArrow) deliveryArrow.classList.remove('open');

    // Mark required fields
    var reqSettings = cachedRequiredSettings || getDefaultRequiredSettings();
    var templateReqs = reqSettings.template || {};
    var tplFieldMap = {
        prosjektnavn: 'tpl-edit-prosjektnavn',
        prosjektnr: 'tpl-edit-prosjektnr',
        oppdragsgiver: 'tpl-edit-oppdragsgiver',
        kundensRef: 'tpl-edit-kundensRef',
        fakturaadresse: 'tpl-edit-fakturaadresse'
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
                TPL_DELIVERY_FIELDS.forEach(function(f) {
                    var el = document.getElementById('tpl-edit-' + f);
                    if (el) el.value = tpl[f] || '';
                });
                // Åpne leveringsadresse-seksjon hvis malen har data
                if (_tplHasDeliveryData(tpl)) {
                    var b = document.getElementById('tpl-delivery-body');
                    var a = document.getElementById('tpl-delivery-arrow');
                    if (b) b.style.display = '';
                    if (a) a.classList.add('open');
                }
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
    TPL_DELIVERY_FIELDS.forEach(function(f) {
        var el = document.getElementById('tpl-edit-' + f);
        if (el) el.value = tpl[f] || '';
    });
    if (_tplHasDeliveryData(tpl)) {
        var b = document.getElementById('tpl-delivery-body');
        var a = document.getElementById('tpl-delivery-arrow');
        if (b) b.style.display = '';
        if (a) a.classList.add('open');
    }
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
        fakturaadresse: document.getElementById('tpl-edit-fakturaadresse').value.trim()
    };
    TPL_DELIVERY_FIELDS.forEach(function(f) {
        var el = document.getElementById('tpl-edit-' + f);
        data[f] = el ? el.value.trim() : '';
    });

    // Validate required template fields
    var reqSettings = cachedRequiredSettings || getDefaultRequiredSettings();
    var templateReqs = reqSettings.template || {};
    var validationKeys = {
        prosjektnavn: 'validation_prosjektnavn',
        prosjektnr: 'validation_prosjektnr',
        oppdragsgiver: 'validation_oppdragsgiver',
        kundensRef: 'validation_kundens_ref',
        fakturaadresse: 'validation_fakturaadresse'
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

        // Firebase in background
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('templates').doc(_editingTemplateId).update(data)
                .catch(function(e) { console.error('Update template error:', e); });
        }
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

        // Firebase in background
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('templates').doc(data.id).set(data)
                .catch(function(e) { console.error('Create template error:', e); });
        }
    }

    closeTemplateEditor();
    _renderSettingsTemplateListFromData(templates);
}

async function toggleTemplateActive(templateId) {
    var tpl = await _findTemplateById(templateId);
    if (!tpl) return;

    var newActive = tpl.active === false ? true : false;

    // Update visual state + localStorage immediately (optimistic)
    var itemEl = document.querySelector('.settings-template-item[data-id="' + templateId + '"]');
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

    // Firebase in background
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('templates').doc(templateId).update({ active: newActive })
            .catch(function(e) { console.error('Toggle template error:', e); });
    }
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
        var el = document.querySelector('.settings-template-item[data-id="' + templateId + '"]');
        if (el) el.remove();
        // Show empty message if no items left
        var listEl = document.getElementById('settings-template-list');
        if (listEl && !listEl.querySelector('.settings-template-item')) {
            listEl.innerHTML = '<div class="no-saved">' + t('no_templates_settings') + '</div>';
        }

        // Firebase in background
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('templates').doc(templateId).delete()
                .catch(function(e) { console.error('Delete template error:', e); });
        }
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
        // Plan field
        var planDisplay = card.querySelector('.plan-display');
        if (planDisplay) {
            var planField = planDisplay.closest('.mobile-field');
            if (planField) {
                if (saveReqs.plan) {
                    planField.classList.add('field-required');
                } else {
                    planField.classList.remove('field-required');
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

var _defaultsTab = 'own';

async function getDefaultSettings(tab) {
    var fbDoc = tab === 'service' ? 'defaults_service' : tab === 'kappe' ? 'defaults_kappe' : 'defaults';
    var storageKey = tab === 'service' ? SERVICE_DEFAULTS_KEY : tab === 'kappe' ? KAPPE_DEFAULTS_KEY : DEFAULTS_KEY;
    if (currentUser && db) {
        try {
            var doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc(fbDoc).get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.error('Defaults error:', e);
        }
    }
    var stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : {};
}

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
    } catch (e) { /* localStorage-cache brukes som fallback */ }
}

function saveDefaultSettings() {
    if (_defaultsTab === 'service') {
        // Save service defaults
        var sDefaults = {};
        var montorEl = document.getElementById('default-service-montor');
        if (montorEl && montorEl.value.trim()) sDefaults.montor = montorEl.value.trim();
        var existing = safeParseJSON(SERVICE_DEFAULTS_KEY, {});
        if (existing.autofill_uke !== undefined) sDefaults.autofill_uke = existing.autofill_uke;
        safeSetItem(SERVICE_DEFAULTS_KEY, JSON.stringify(sDefaults));
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults_service').set(sDefaults)
                .catch(function(e) { console.error('Save service defaults error:', e); });
        }
        return;
    }

    if (_defaultsTab === 'kappe') {
        var kDefaults = {};
        KAPPE_DEFAULT_FIELDS.forEach(function(field) {
            var el = document.getElementById('default-kappe-' + field);
            if (el && el.value.trim()) kDefaults[field] = el.value.trim();
        });
        // Bevar autofill-flagg
        var kExisting = safeParseJSON(KAPPE_DEFAULTS_KEY, {});
        KAPPE_DEFAULT_FIELDS.forEach(function(field) {
            var k = 'autofill_' + field;
            if (kExisting[k] !== undefined) kDefaults[k] = kExisting[k];
        });
        safeSetItem(KAPPE_DEFAULTS_KEY, JSON.stringify(kDefaults));
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults_kappe').set(kDefaults)
                .catch(function(e) { console.error('Save kappe defaults error:', e); });
        }
        return;
    }

    // Save ordreseddel defaults
    var defaults = {};
    DEFAULT_FIELDS.forEach(field => {
        var val = document.getElementById('default-' + field).value.trim();
        if (val) defaults[field] = val;
    });
    var key = DEFAULTS_KEY;
    var fbDoc = 'defaults';
    var existing = safeParseJSON(key, {});
    ['autofill_montor', 'autofill_avdeling', 'autofill_sted', 'autofill_uke', 'autofill_dato'].forEach(function(k) {
        if (existing[k] !== undefined) defaults[k] = existing[k];
    });
    safeSetItem(key, JSON.stringify(defaults));

    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc(fbDoc).set(defaults)
            .catch(function(e) { console.error('Save defaults error:', e); });
    }
}

// Auto-save defaults on blur
let defaultsInitialValues = {};
let defaultsAutoSaveInitialized = false;

function initDefaultsAutoSave() {
    if (defaultsAutoSaveInitialized) return;
    defaultsAutoSaveInitialized = true;

    DEFAULT_FIELDS.forEach(field => {
        const input = document.getElementById('default-' + field);
        if (input) {
            input.addEventListener('blur', async function() {
                const newVal = this.value.trim();
                if (newVal !== defaultsInitialValues[field]) {
                    defaultsInitialValues[field] = newVal;
                    await saveDefaultSettings();
                    showNotificationModal(t('settings_defaults_saved'), true);
                }
            });
        }
    });

    // Service defaults auto-save
    var serviceMontor = document.getElementById('default-service-montor');
    if (serviceMontor) {
        serviceMontor.addEventListener('blur', function() {
            var prev = _defaultsTab;
            _defaultsTab = 'service';
            saveDefaultSettings();
            _defaultsTab = prev;
            showNotificationModal(t('settings_defaults_saved'), true);
        });
    }

    // Kappe defaults auto-save
    KAPPE_DEFAULT_FIELDS.forEach(function(field) {
        var input = document.getElementById('default-kappe-' + field);
        if (!input) return;
        input.addEventListener('blur', function() {
            var newVal = this.value.trim();
            var cacheKey = 'kappe_' + field;
            if (newVal !== defaultsInitialValues[cacheKey]) {
                defaultsInitialValues[cacheKey] = newVal;
                var prev = _defaultsTab;
                _defaultsTab = 'kappe';
                saveDefaultSettings();
                _defaultsTab = prev;
                showNotificationModal(t('settings_defaults_saved'), true);
            }
        });
    });
}

function switchDefaultsTab(tab) {
    _defaultsTab = tab;
    sessionStorage.setItem('firesafe_defaults_tab', tab);

    // Toggle tab active state
    var tabs = document.querySelectorAll('#settings-page-defaults .settings-tab');
    tabs.forEach(function(t, i) {
        t.classList.toggle('active',
            (tab === 'own' && i === 0)
            || (tab === 'service' && i === 1)
            || (tab === 'kappe' && i === 2));
    });

    // Toggle content
    var ownContent = document.getElementById('defaults-own-content');
    var serviceContent = document.getElementById('defaults-service-content');
    var kappeContent = document.getElementById('defaults-kappe-content');
    if (ownContent) ownContent.style.display = tab === 'own' ? '' : 'none';
    if (serviceContent) serviceContent.style.display = tab === 'service' ? '' : 'none';
    if (kappeContent) kappeContent.style.display = tab === 'kappe' ? '' : 'none';

    loadDefaultsForTab(tab);
}

var KAPPE_DEFAULT_FIELDS = ['avdeling', 'bestiller', 'mottaker', 'veiadresse', 'postnr', 'poststed', 'kontakt', 'tlf'];

function _applyDefaultsToUI(defaults, tab) {
    if (!tab || tab === 'own') {
        DEFAULT_FIELDS.forEach(function(field) {
            var input = document.getElementById('default-' + field);
            if (input) {
                input.value = defaults[field] || '';
                defaultsInitialValues[field] = input.value;
            }
        });
        ['montor', 'avdeling', 'sted', 'uke', 'dato'].forEach(function(key) {
            var cb = document.getElementById('autofill-' + key);
            if (cb) {
                cb.checked = defaults['autofill_' + key] !== false;
                _updateAutofillInputState(key);
            }
        });
    } else if (tab === 'service') {
        var montorEl = document.getElementById('default-service-montor');
        if (montorEl) montorEl.value = defaults.montor || '';
        var montorCb = document.getElementById('autofill-service-montor');
        if (montorCb) {
            montorCb.checked = defaults.autofill_montor !== false;
            _updateAutofillInputState('montor', 'service');
        }
        var datoEl = document.getElementById('autofill-service-dato');
        if (datoEl) datoEl.checked = defaults.autofill_dato !== false;
    } else if (tab === 'kappe') {
        KAPPE_DEFAULT_FIELDS.forEach(function(field) {
            var input = document.getElementById('default-kappe-' + field);
            if (input) {
                input.value = defaults[field] || '';
                defaultsInitialValues['kappe_' + field] = input.value;
            }
            var cb = document.getElementById('autofill-kappe-' + field);
            if (cb) {
                cb.checked = defaults['autofill_' + field] !== false;
                _updateAutofillInputState(field, 'kappe');
            }
        });
    }
}

function _updateAutofillInputState(key, type) {
    var prefix = type === 'service' ? 'default-service-'
              : type === 'kappe' ? 'default-kappe-'
              : 'default-';
    var cbId = type === 'service' ? 'autofill-service-' + key
             : type === 'kappe' ? 'autofill-kappe-' + key
             : 'autofill-' + key;
    var input = document.getElementById(prefix + key);
    var cb = document.getElementById(cbId);
    if (input && cb) {
        input.disabled = !cb.checked;
    }
}

function loadDefaultsForTab(tab) {
    var storageKey = tab === 'service' ? SERVICE_DEFAULTS_KEY : tab === 'kappe' ? KAPPE_DEFAULTS_KEY : DEFAULTS_KEY;
    // Show cached immediately
    var stored = localStorage.getItem(storageKey);
    _applyDefaultsToUI(stored ? JSON.parse(stored) : {}, tab);
    // Background refresh
    getDefaultSettings(tab).then(function(defaults) {
        if (document.body.classList.contains('settings-modal-open'))
            _applyDefaultsToUI(defaults, tab);
    });
}

function autoFillDefaults(type) {
    var stored = localStorage.getItem(DEFAULTS_KEY);
    var defaults = stored ? JSON.parse(stored) : {};
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

function getAutofillFlags(type) {
    var stored = localStorage.getItem(DEFAULTS_KEY);
    var defaults = stored ? JSON.parse(stored) : {};
    return {
        montor: defaults.autofill_montor !== false,
        avdeling: defaults.autofill_avdeling !== false,
        uke: defaults.autofill_uke !== false,
        dato: defaults.autofill_dato !== false,
        sted: defaults.autofill_sted !== false
    };
}

function saveAutofillToggle(key, value, type) {
    var scope = type || _defaultsTab;
    var storageKey = scope === 'service' ? SERVICE_DEFAULTS_KEY
                   : scope === 'kappe' ? KAPPE_DEFAULTS_KEY
                   : DEFAULTS_KEY;
    var fbDoc = scope === 'service' ? 'defaults_service'
              : scope === 'kappe' ? 'defaults_kappe'
              : 'defaults';
    var stored = localStorage.getItem(storageKey);
    var defaults = stored ? JSON.parse(stored) : {};
    defaults['autofill_' + key] = value;
    safeSetItem(storageKey, JSON.stringify(defaults));

    // Update input disabled state
    _updateAutofillInputState(key, scope === 'service' ? 'service' : scope === 'kappe' ? 'kappe' : undefined);

    // Firebase in background
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc(fbDoc).set(defaults)
            .catch(function(e) { console.error('Save autofill toggle:', e); });
    }
}

function renderSettingsRanges() {
    const container = document.getElementById('settings-ranges');
    const countEl = document.getElementById('settings-count-ranges');
    if (settingsRanges.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_ranges') + '</div>';
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
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings)
            .catch(function(e) { console.error('Save range error:', e); });
    }
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
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings)
                .catch(function(e) { console.error('Remove range error:', e); });
        }
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
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings)
            .catch(function(e) { console.error('Save give-away error:', e); });
    }
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
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings)
                .catch(function(e) { console.error('Remove give-away error:', e); });
        }
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
        const descVal = descInput.getAttribute('data-full-value') || descInput.value;
        if (descVal.trim()) return true;
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
        el.removeAttribute('data-full-value');
    });

    // Clear signature
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    const now = new Date();
    const flags = getAutofillFlags();
    _setSigneringDatoToday();
    if (flags.uke) {
        const week = 'Uke ' + getWeekNumber(now);
        document.getElementById('dato').value = week;
        document.getElementById('mobile-dato').value = week;
    }

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

function duplicateCurrentForm() {
    // Clear order number and signature fields
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    // Sett uke basert på autofyll-innstillinger; signering-dato alltid dagens
    var now = new Date();
    var flags = getAutofillFlags();
    if (flags.uke) {
        var week = 'Uke ' + getWeekNumber(now);
        document.getElementById('dato').value = week;
        document.getElementById('mobile-dato').value = week;
    }
    _setSigneringDatoToday();

    // Reset bestillinger til 1 tomt ordrekort
    var container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();
    document.getElementById('work-lines').innerHTML = '';

    // Mark as unsaved
    lastSavedData = null;

    // Remove sent banner if visible
    document.getElementById('sent-banner').style.display = 'none';
    setFormReadOnly(false);

    // Auto-fill next order number
    autoFillOrderNumber();
    window.scrollTo(0, 0);
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
        _selectTab = sessionStorage.getItem('firesafe_hent_tab') || 'own';
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
        // Clear visual selection from all rows
        document.querySelectorAll('#saved-list .saved-item.selected, #service-list .saved-item.selected')
            .forEach(function(el) { el.classList.remove('selected'); });
    }
    updateSelectionUI();
}

function toggleFormSelection(idx, rowEl) {
    if (_selectedSet.has(idx)) {
        _selectedSet.delete(idx);
        if (rowEl) rowEl.classList.remove('selected');
    } else {
        _selectedSet.add(idx);
        if (rowEl) rowEl.classList.add('selected');
    }
    updateSelectionUI();
}

function updateSelectionUI() {
    var count = _selectedSet.size;
    var countEl = document.getElementById('bulk-count');
    if (countEl) countEl.textContent = count + ' ' + t('bulk_count_suffix');
    var exportBtn = document.getElementById('bulk-export-btn');
    if (exportBtn) exportBtn.disabled = count === 0;

    var selectAllBtn = document.getElementById('bulk-select-all-btn');
    if (selectAllBtn) {
        var listId = _selectTab === 'service' ? 'service-list' : 'saved-list';
        var items = document.querySelectorAll('#' + listId + ' .saved-item');
        var allSelected = items.length > 0 && Array.prototype.every.call(items, function(el) {
            var idx = parseInt(el.getAttribute('data-index'), 10);
            return !isNaN(idx) && _selectedSet.has(idx);
        });
        selectAllBtn.textContent = allSelected ? t('btn_deselect_all') : t('btn_select_all');
        selectAllBtn.disabled = items.length === 0;
    }
}

function toggleSelectAllVisible() {
    if (!_selectMode) return;
    var listId = _selectTab === 'service' ? 'service-list' : 'saved-list';
    var items = document.querySelectorAll('#' + listId + ' .saved-item');
    if (items.length === 0) return;
    var allSelected = Array.prototype.every.call(items, function(el) {
        var idx = parseInt(el.getAttribute('data-index'), 10);
        return !isNaN(idx) && _selectedSet.has(idx);
    });
    items.forEach(function(el) {
        var idx = parseInt(el.getAttribute('data-index'), 10);
        if (isNaN(idx)) return;
        if (allSelected) {
            _selectedSet.delete(idx);
            el.classList.remove('selected');
        } else {
            _selectedSet.add(idx);
            el.classList.add('selected');
        }
    });
    updateSelectionUI();
}

function _getSelectedForms() {
    var src = _selectTab === 'service' ? (window.loadedServiceForms || []) : (window.loadedForms || []);
    var out = [];
    for (var i = 0; i < src.length; i++) {
        if (_selectedSet.has(i)) out.push(src[i]);
    }
    // Sorter etter ordreseddelNr (numerisk stigende) for konsistent rekkefølge i PDF
    out.sort(function(a, b) {
        var na = parseInt(a.ordreseddelNr, 10) || 0;
        var nb = parseInt(b.ordreseddelNr, 10) || 0;
        return na - nb;
    });
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
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value || 'ukjent';
    // Bruk uke fra #dato-feltet (inneholder "Uke 16") eller fallback til dagens uke
    const datoVal = document.getElementById('dato').value || '';
    const year = new Date().getFullYear();
    let uke;
    const match = datoVal.match(/(\d+)/);
    if (match) {
        const n = parseInt(match[1], 10);
        if (n >= 1 && n <= 53) uke = n;
    }
    if (!uke) uke = getWeekNumber(new Date());
    return `ordreseddel_${ordrenr}_Uke-${uke}-${year}.${ext}`;
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

async function doSharePDF() {
    if (!validateRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderFormToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 210, 297, 'JPEG', 0.95);
        var blob = pdf.output('blob');
        var file = new File([blob], getExportFilename('pdf'), { type: 'application/pdf' });
        await navigator.share({ files: [file] });
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doSharePNG() {
    if (!validateRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderFormToCanvas();
        var dataUrl = canvas.toDataURL('image/png');
        var res = await fetch(dataUrl);
        var blob = await res.blob();
        var file = new File([blob], getExportFilename('png'), { type: 'image/png' });
        await navigator.share({ files: [file] });
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

// ============================================
// BULK EXPORT (multi-select PDF)
// ============================================
// Tvinger #view-form synlig under rendering (nødvendig for html2canvas når vi er i saved-modal).
// Returnerer en restore-funksjon.
// Beregner custom PDF-sidehøyde basert på canvas-aspect og fast sidebredde.
// Minimum-høyde = standard A4-proporsjon for gitt bredde, slik at korte skjemaer
// beholder vanlig A4-utseende. Lange skjemaer får lengre side (vertikalt), slik
// at bredden alltid forblir konsistent (210mm portrait / 297mm landscape).
function _customPageHeight(canvas, pageWidth, minHeight) {
    var natural = canvas.height * pageWidth / canvas.width;
    return Math.max(minHeight, natural);
}

// Lager en ny PDF med custom sidestørrelse som matcher canvas-aspect.
function _createPdfFromCanvas(canvas, pageWidth, minHeight, imageType, quality) {
    var jsPDF = window.jspdf.jsPDF;
    var type = imageType || 'PNG';
    var mime = type === 'JPEG' ? 'image/jpeg' : 'image/png';
    var customHeight = _customPageHeight(canvas, pageWidth, minHeight);
    var orientation = pageWidth > customHeight ? 'l' : 'p';
    var pdf = new jsPDF({ orientation: orientation, unit: 'mm', format: [pageWidth, customHeight] });
    var dataUrl = (quality != null) ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
    pdf.addImage(dataUrl, type, 0, 0, pageWidth, customHeight);
    return pdf;
}

// Legger til en ny side med custom størrelse på eksisterende PDF, og tegner canvas.
function _addPageFromCanvas(pdf, canvas, pageWidth, minHeight, imageType, quality) {
    var type = imageType || 'PNG';
    var mime = type === 'JPEG' ? 'image/jpeg' : 'image/png';
    var customHeight = _customPageHeight(canvas, pageWidth, minHeight);
    var orientation = pageWidth > customHeight ? 'l' : 'p';
    pdf.addPage([pageWidth, customHeight], orientation);
    var dataUrl = (quality != null) ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
    pdf.addImage(dataUrl, type, 0, 0, pageWidth, customHeight);
}

// Lager A4-PDF (297×210mm landscape eller 210×297mm portrait) og legger canvas inn
// ved naturlig skala (canvas.width → pageW). Hvis canvas er høyere enn én A4-side
// tillater, deles canvas i skiver og hver skive får sin egen A4-side (multi-page).
// Dette bevarer tekststørrelsen uansett hvor mye innhold det er.
function _createA4PdfFromCanvas(canvas, orientation, imageType, quality) {
    var jsPDF = window.jspdf.jsPDF;
    var type = imageType || 'PNG';
    var mime = type === 'JPEG' ? 'image/jpeg' : 'image/png';
    var isLand = orientation === 'l' || orientation === 'landscape';
    var pageW = isLand ? 297 : 210;
    var pageH = isLand ? 210 : 297;
    var pdf = new jsPDF({ orientation: isLand ? 'l' : 'p', unit: 'mm', format: 'a4' });
    var scale = pageW / canvas.width;
    var canvasHmm = canvas.height * scale;

    if (canvasHmm <= pageH) {
        var offsetY = (pageH - canvasHmm) / 2;
        var dataUrl = (quality != null) ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
        pdf.addImage(dataUrl, type, 0, offsetY, pageW, canvasHmm);
        return pdf;
    }

    var pagePixH = Math.floor(pageH / scale);
    var numPages = Math.ceil(canvas.height / pagePixH);
    for (var i = 0; i < numPages; i++) {
        if (i > 0) pdf.addPage('a4', isLand ? 'l' : 'p');
        var sliceY = i * pagePixH;
        var sliceH = Math.min(pagePixH, canvas.height - sliceY);
        var slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceH;
        var ctx = slice.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, -sliceY);
        var sliceHmm = sliceH * scale;
        var dUrl = (quality != null) ? slice.toDataURL(mime, quality) : slice.toDataURL(mime);
        pdf.addImage(dUrl, type, 0, 0, pageW, sliceHmm);
    }
    return pdf;
}

// Lager et nytt canvas med fast A4-aspect (297:210 landscape eller 210:297 portrait)
// og tegner original-canvas proporsjonalt sentrert med hvit bakgrunn. Brukes for
// PNG-eksport slik at filen har samme print-kompatible aspekt som PDF.
function _createA4CanvasFromCanvas(canvas, orientation) {
    var isLand = orientation === 'l' || orientation === 'landscape';
    var aspect = isLand ? (297 / 210) : (210 / 297);
    var srcAspect = canvas.width / canvas.height;
    var outW, outH;
    if (srcAspect > aspect) {
        outW = canvas.width;
        outH = Math.round(canvas.width / aspect);
    } else {
        outH = canvas.height;
        outW = Math.round(canvas.height * aspect);
    }
    var out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    var drawW, drawH;
    if (srcAspect > aspect) {
        drawW = outW;
        drawH = Math.round(outW / srcAspect);
    } else {
        drawH = outH;
        drawW = Math.round(outH * srcAspect);
    }
    var offsetX = Math.round((outW - drawW) / 2);
    var offsetY = Math.round((outH - drawH) / 2);
    ctx.drawImage(canvas, offsetX, offsetY, drawW, drawH);
    return out;
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
    ['saved-modal-open', 'template-modal-open', 'settings-modal-open', 'calculator-modal-open', 'service-view-open'].forEach(function(cls) {
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

function _bulkFilename(ext, type) {
    var prefix = (type === 'service') ? 'lageruttak_samlet' : 'ordreseddel_samlet';
    return prefix + '_' + _sharedUkeYearOrRange() + '.' + (ext || 'pdf');
}

function _pngFilenameForForm(data, fallbackIdx, isService) {
    var uke = _ukeYearForForm(data);
    if (isService) {
        var suffix = fallbackIdx > 0 ? '_' + (fallbackIdx + 1) : '';
        return 'lageruttak_' + uke + suffix + '.png';
    }
    var nr = (data && data.ordreseddelNr) ? data.ordreseddelNr : 'skjema_' + (fallbackIdx + 1);
    return 'ordreseddel_' + nr + '_' + uke + '.png';
}

function _pdfFilenameForForm(data, fallbackIdx, isService) {
    var uke = _ukeYearForForm(data);
    if (isService) {
        var suffix = fallbackIdx > 0 ? '_' + (fallbackIdx + 1) : '';
        return 'lageruttak_' + uke + suffix + '.pdf';
    }
    var nr = (data && data.ordreseddelNr) ? data.ordreseddelNr : 'skjema_' + (fallbackIdx + 1);
    return 'ordreseddel_' + nr + '_' + uke + '.pdf';
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
            files.push(new File([blob], _pdfFilenameForForm(forms[i], i, true), { type: 'application/pdf' }));
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
            files.push(new File([blob], _pngFilenameForForm(forms[i], i, true), { type: 'image/png' }));
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
        if (currentUser && db) {
            var docId = data.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return db.collection('users').doc(currentUser.uid).collection('archive').doc(docId).set(data);
            }).then(function() {
                return db.collection('users').doc(currentUser.uid).collection('forms').doc(docId).delete();
            }).catch(function(e) { console.error('Bulk mark-sent (own) error:', e); });
        }
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
        if (currentUser && db) {
            var docId = data.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return db.collection('users').doc(currentUser.uid).collection('serviceArchive').doc(docId).set(data);
            }).then(function() {
                return db.collection('users').doc(currentUser.uid).collection('serviceforms').doc(docId).delete();
            }).catch(function(e) { console.error('Bulk mark-sent (service) error:', e); });
        }
    } catch (e) { console.error('Bulk mark-sent (service) error:', e); }
}

function _bulkMarkSelectedAsSent() {
    var forms = _getSelectedForms();
    var isService = _selectTab === 'service';
    for (var i = 0; i < forms.length; i++) {
        if (forms[i]._isSent) continue; // already sent
        if (isService) _markServiceFormDataAsSent(forms[i]);
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
        var pdf = _selectTab === 'service' ? await _bulkBuildServicePDF() : await _bulkBuildOwnPDF();
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
        var files = _selectTab === 'service' ? await _bulkBuildServicePNGs() : await _bulkBuildOwnPNGs();
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
        var pdf = _selectTab === 'service' ? await _bulkBuildServicePDF() : await _bulkBuildOwnPDF();
        if (!pdf) return;
        var blob = pdf.output('blob');
        var file = new File([blob], _bulkFilename('pdf', _selectTab), { type: 'application/pdf' });
        if (!navigator.canShare({ files: [file] })) {
            showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
            return;
        }
        await navigator.share({ files: [file] });
        await _bulkFinishAfterExport(markSent);
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
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
        var files = _selectTab === 'service' ? await _bulkBuildServicePNGs() : await _bulkBuildOwnPNGs();
        if (!files.length) return;
        if (!navigator.canShare({ files: files })) {
            showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
            return;
        }
        await navigator.share({ files: files });
        await _bulkFinishAfterExport(markSent);
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
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
        var files = _selectTab === 'service' ? await _bulkBuildServicePDFsSeparate() : await _bulkBuildOwnPDFsSeparate();
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
        var files = _selectTab === 'service' ? await _bulkBuildServicePDFsSeparate() : await _bulkBuildOwnPDFsSeparate();
        if (!files.length) return;
        if (!navigator.canShare({ files: files })) {
            showNotificationModal(t('share_not_supported') || 'Deling ikke støttet');
            return;
        }
        await navigator.share({ files: files });
        await _bulkFinishAfterExport(markSent);
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

// ============================================
// SERVICE FORM FUNCTIONS
// ============================================

var _serviceCurrentId = null; // Track current loaded service form id
var _serviceLastSavedData = null; // For unsaved changes detection

function openNewServiceForm() {
    // Close template modal
    document.body.classList.remove('template-modal-open');

    // Reset service form and autofill from service defaults
    var serviceDefaults = safeParseJSON(SERVICE_DEFAULTS_KEY, {});
    document.getElementById('service-montor').value = serviceDefaults.montor || '';
    var ukeField = document.getElementById('service-uke');
    if (ukeField) {
        ukeField.value = (serviceDefaults.autofill_uke !== false) ? String(getWeekNumber(new Date())) : '';
    }
    document.getElementById('service-signatur').value = '';
    window._serviceSignaturePaths = [];
    _serviceCurrentId = null;
    var srvPreviewImg = document.getElementById('service-signature-preview-img');
    if (srvPreviewImg) { srvPreviewImg.style.display = 'none'; srvPreviewImg.src = ''; }
    var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
    if (srvPlaceholder) srvPlaceholder.style.display = '';

    // Init empty entry with autofill
    var container = document.getElementById('service-entries');
    container.innerHTML = '';
    var entryData = {};
    if (serviceDefaults.autofill_dato !== false) {
        entryData.dato = formatDate(new Date());
    }
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
    document.body.classList.remove('service-view-open');
    _serviceCurrentId = null;
    _serviceLastSavedData = null;
    sessionStorage.removeItem('firesafe_service_current');
    sessionStorage.removeItem('firesafe_service_sent');

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

        // Firebase in background
        if (currentUser && db) {
            var docId = data.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return db.collection('users').doc(currentUser.uid).collection('serviceforms').doc(docId).set(data);
            }).then(function() {
                if (wasSent) {
                    return db.collection('users').doc(currentUser.uid).collection('serviceArchive').doc(docId).delete();
                }
            }).catch(function(e) { console.error('Service save Firebase error:', e); });
        }
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function loadServiceTab() {
    // Show cached data immediately
    var cachedSaved = safeParseJSON(SERVICE_STORAGE_KEY, []);
    var cachedSent = safeParseJSON(SERVICE_ARCHIVE_KEY, []);
    var cachedForms = cachedSaved.map(function(f) { return Object.assign({}, f, { _isSent: false }); })
        .concat(cachedSent.map(function(f) { return Object.assign({}, f, { _isSent: true }); }))
        .sort(function(a, b) {
            if (a._isSent !== b._isSent) return a._isSent ? 1 : -1;
            return (b.savedAt || '').localeCompare(a.savedAt || '');
        });
    renderServiceFormsList(cachedForms);

    // Refresh from Firestore
    if (currentUser && db) {
        Promise.all([getServiceForms(), getServiceSentForms()]).then(function(results) {
            if (Date.now() - _lastLocalSaveTs < 5000) return;
            var savedResult = results[0], sentResult = results[1];
            _serviceLastDoc = savedResult.lastDoc;
            _serviceSentLastDoc = sentResult.lastDoc;
            safeSetItem(SERVICE_STORAGE_KEY, JSON.stringify(savedResult.forms.slice(0, 50)));
            safeSetItem(SERVICE_ARCHIVE_KEY, JSON.stringify(sentResult.forms.slice(0, 50)));
            var allForms = savedResult.forms.map(function(f) { return Object.assign({}, f, { _isSent: false }); })
                .concat(sentResult.forms.map(function(f) { return Object.assign({}, f, { _isSent: true }); }))
                .sort(function(a, b) {
                    if (a._isSent !== b._isSent) return a._isSent ? 1 : -1;
                    return (b.savedAt || '').localeCompare(a.savedAt || '');
                });
            if (document.body.classList.contains('saved-modal-open')) {
                renderServiceFormsList(allForms);
            }
        }).catch(function(e) { console.error('Refresh service forms:', e); });
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

    // Autofill dato in entries if enabled
    var serviceDefaults = safeParseJSON(SERVICE_DEFAULTS_KEY, {});
    if (serviceDefaults.autofill_dato !== false && copy.entries) {
        var today = formatDate(new Date());
        copy.entries.forEach(function(entry) { entry.dato = today; });
    }

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
        // Firebase
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid).collection(col).doc(formData.id).delete()
                .catch(function(e) { console.error('Delete service form error:', e); });
        }
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

        // Firebase
        if (currentUser && db) {
            var docId = data.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return db.collection('users').doc(currentUser.uid).collection('serviceArchive').doc(docId).set(data);
            }).then(function() {
                return db.collection('users').doc(currentUser.uid).collection('serviceforms').doc(docId).delete();
            }).catch(function(e) { console.error('Mark service as sent error:', e); });
        }
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
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doServiceSharePDF(); closeActionPopup()">' + shareIcon + ' PDF</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PDF</button>';
    var shareBtnPNG = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doServiceSharePNG(); closeActionPopup()">' + shareIcon + ' PNG</button>'
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
    var allMats = cachedMaterialOptions || [];
    var matNames = allMats.map(function(m) {
        if (!m.name) return '';
        var n = m.name.charAt(0).toUpperCase() + m.name.slice(1);
        return formatKabelhylseSpec(n.replace(/ø(?=\d)/g, 'Ø'));
    });

    var matCols = cols || 3;
    var matRowCount = Math.max(2, Math.ceil(matNames.length / matCols));
    // Pad to fill all slots
    while (matNames.length < matCols * matRowCount) matNames.push('');

    // Helper: check if material is a spec type
    function isSpecType(baseName) {
        var mat = allMats.find(function(m) { return m.name === baseName; });
        return mat && (mat.type === 'mansjett' || mat.type === 'brannpakning' || mat.type === 'kabelhylse');
    }

    // Helper: build cell value for a material in an entry
    function buildCellValue(baseName, entryMaterials) {
        if (!baseName) return '';
        var mats = entryMaterials || [];

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
                    var stdIsMeter = (m.enhet || '').toLowerCase() === 'meter';
                    var stdUnitLabel = stdIsMeter ? ' meter' : ' stk';
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
            '<td colspan="' + (matCols - 1) + '" class="se-montor-value" style="line-height:20px;">' + escapeHtml(data.montor) + '</td>' +
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
            allRows += '<th>' + escapeHtml(matNames[c] || '') + '</th>';
        }
        allRows += '</tr>';

        // First material group: info values (rowspan covers remaining rows) + material data
        allRows += '<tr>' +
            '<td rowspan="' + valueRowspan + '" class="se-info-value-cell">' + escapeHtml(entry.dato || '') + '</td>' +
            '<td rowspan="' + valueRowspan + '" class="se-info-value-cell">' + escapeHtml(entry.prosjektnr || '') + '</td>' +
            '<td rowspan="' + valueRowspan + '" class="se-info-value-cell">' + escapeHtml(entry.prosjektnavn || '') + '</td>';
        for (var c = 0; c < matCols; c++) {
            var val = buildCellValue(matNames[c], entry.materials);
            allRows += '<td' + (val ? ' class="se-has-value"' : '') + '>' + val + '</td>';
        }
        allRows += '</tr>';

        // Additional material groups (2nd, 3rd, etc.)
        for (var mr = 1; mr < matRowCount; mr++) {
            // Header row
            allRows += '<tr>';
            for (var c = 0; c < matCols; c++) {
                var idx = mr * matCols + c;
                allRows += '<th>' + escapeHtml(matNames[idx] || '') + '</th>';
            }
            allRows += '</tr>';

            // Data row
            allRows += '<tr>';
            for (var c = 0; c < matCols; c++) {
                var idx = mr * matCols + c;
                var val = buildCellValue(matNames[idx], entry.materials);
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
    document.getElementById('preview-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';

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

    var header = document.querySelector('.preview-overlay-header');
    var cs = getComputedStyle(scroll);
    var padLR = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var availWidth = scroll.clientWidth - padLR;
    var scale = Math.min(availWidth / 1250, 1);

    if (scale < 1) {
        container.style.transformOrigin = 'top left';
        container.style.transform = 'scale(' + scale + ')';
        container.style.marginBottom = (-(container.offsetHeight * (1 - scale))) + 'px';
        container.style.marginRight = (-(container.offsetWidth * (1 - scale))) + 'px';
        container.style.marginLeft = '';
        if (header) {
            header.style.maxWidth = (container.offsetWidth * scale) + 'px';
            header.style.margin = '0';
        }
    } else {
        container.style.transform = '';
        container.style.transformOrigin = '';
        container.style.marginLeft = 'auto';
        container.style.marginRight = 'auto';
        container.style.marginBottom = '';
        if (header) {
            header.style.maxWidth = '1250px';
            header.style.margin = '0 auto';
        }
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
    var ukeVal = (document.getElementById('service-uke') || {}).value || '';
    var year = new Date().getFullYear();
    var uke;
    var match = ukeVal.match(/(\d+)/);
    if (match) {
        var n = parseInt(match[1], 10);
        if (n >= 1 && n <= 53) uke = n;
    }
    if (!uke) uke = getWeekNumber(new Date());
    return 'lageruttak_Uke-' + uke + '-' + year + '.' + ext;
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

async function doServiceSharePDF() {
    if (!validateServiceRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderServiceToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
        var blob = pdf.output('blob');
        var file = new File([blob], getServiceExportFilename('pdf'), { type: 'application/pdf' });
        await navigator.share({ files: [file] });
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doServiceSharePNG() {
    if (!validateServiceRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderServiceToCanvas();
        var dataUrl = canvas.toDataURL('image/png');
        var res = await fetch(dataUrl);
        var blob = await res.blob();
        var file = new File([blob], getServiceExportFilename('png'), { type: 'image/png' });
        await navigator.share({ files: [file] });
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
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
    // Set toolbar height CSS variable (replaces hardcoded 60px)
    var toolbar = document.querySelector('.toolbar');
    function syncToolbarHeight() {
        if (toolbar) {
            document.documentElement.style.setProperty('--toolbar-h', toolbar.offsetHeight + 'px');
        }
    }
    syncToolbarHeight();
    // Recalculate on rotation / resize so form content doesn't end up behind toolbar
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
    // Regel: alltid dagens dato, unntatt for sendte skjemaer (bevar historisk).
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    const _wasSentOnStartup = sessionStorage.getItem('firesafe_current_sent') === '1';
    if (!_wasSentOnStartup) _setSigneringDatoToday();

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

    // Keyboard handling with `interactive-widget=resizes-visual`:
    // When keyboard opens: reparent toolbar into scrollable form content,
    // adjust form bottom to keyboard edge. Toolbar becomes scrollable.
    // When keyboard closes: restore toolbar to body (fixed at bottom).
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function() {
            var vv = window.visualViewport;
            var keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
            var keyboardOpen = keyboardHeight > 100;
            var toolbar = document.querySelector('.toolbar');
            var viewForm = document.getElementById('view-form');
            var serviceView = document.getElementById('service-view');
            var formEl = document.getElementById('mobile-form');
            var serviceFormEl = document.getElementById('service-form');
            var activeView = document.querySelector('.view.active');
            var activeId = activeView ? activeView.id : null;

            if (keyboardOpen) {
                var fullHeight = vv.offsetTop + vv.height;
                if (activeId === 'view-form' && viewForm) {
                    viewForm.style.display = 'block';
                    viewForm.style.bottom = 'auto';
                    viewForm.style.height = fullHeight + 'px';
                    viewForm.style.minHeight = '0';
                    viewForm.style.overscrollBehavior = 'contain';
                }
                if (activeId === 'service-view' && serviceView) {
                    serviceView.style.display = 'block';
                    serviceView.style.bottom = 'auto';
                    serviceView.style.height = fullHeight + 'px';
                    serviceView.style.minHeight = '0';
                    serviceView.style.overscrollBehavior = 'contain';
                }
                // Lock body so scroll can't chain to it
                document.body.style.overflow = 'hidden';
                // Shift popup sheets up so they center in visible area (with smooth transition)
                var popupOffset = (window.innerHeight - fullHeight) / 2;
                var sheets = document.querySelectorAll('.fakturaadresse-popup-sheet, .spec-popup-sheet');
                sheets.forEach(function(s) {
                    s.style.transform = 'translateY(-' + popupOffset + 'px)';
                });
                // Reparent toolbar into scrollable content
                if (toolbar) {
                    var host = null;
                    if (activeId === 'view-form') host = viewForm;
                    else if (activeId === 'service-view') host = serviceView;
                    if (host && toolbar.parentNode !== host) {
                        toolbar.classList.add('toolbar--inflow');
                        host.appendChild(toolbar);
                    }
                }
            } else {
                if (viewForm) { viewForm.style.display = ''; viewForm.style.bottom = ''; viewForm.style.height = ''; viewForm.style.minHeight = ''; viewForm.style.overscrollBehavior = ''; }
                if (serviceView) { serviceView.style.display = ''; serviceView.style.bottom = ''; serviceView.style.height = ''; serviceView.style.minHeight = ''; serviceView.style.overscrollBehavior = ''; }
                document.body.style.overflow = '';
                var sheets = document.querySelectorAll('.fakturaadresse-popup-sheet, .spec-popup-sheet');
                sheets.forEach(function(s) {
                    s.style.transform = '';
                });
                if (toolbar && toolbar.parentNode !== document.body) {
                    toolbar.classList.remove('toolbar--inflow');
                    document.body.appendChild(toolbar);
                }
            }
        });
    }

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
        // Restore from session if available
        var serviceCurrent = sessionStorage.getItem('firesafe_service_current');
        if (serviceCurrent) {
            try {
                var sData = JSON.parse(serviceCurrent);
                _serviceCurrentId = sData.id || null;
                setServiceFormData(sData);
                var wasSent = sessionStorage.getItem('firesafe_service_sent') === '1';
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
        // Home page - render cached templates (filter out deactivated)
        var cached = safeParseJSON(TEMPLATE_KEY, []).filter(function(t) { return t.active !== false; });
        renderTemplateList(cached);
        renderBilHistory();
        _bilHistoryRendered = true;
        updateToolbarState();
        // Background refresh
        if (currentUser && db) {
            getTemplates().then(function(result) {
                _templateLastDoc = result.lastDoc;
                _templateHasMore = result.hasMore;
                safeSetItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
                if (document.body.classList.contains('template-modal-open')) {
                    var activeTemplates = result.forms.filter(function(t) { return t.active !== false; });
                    renderTemplateList(activeTemplates, false, _templateHasMore);
                }
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

window.addEventListener('hashchange', function() {
    if (!currentUser) return; // Ikke naviger uten innlogging
    var hash = window.location.hash.slice(1);

    // If we just rolled back or confirmed, apply without re-guarding
    if (_suppressHashGuard) {
        _suppressHashGuard = false;
        _applyHashNavigation(hash);
        return;
    }

    // Detect if this hashchange leaves a form view with unsaved data
    var currentView = document.querySelector('.view.active');
    var currentId = currentView ? currentView.id : null;
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
                _applyHashNavigation('');
            }
        }, t('btn_continue'), '#E8501A');
        return;
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

function mcCalcPerRoll(segments) {
    return Math.floor(MC_SEGMENTS_PER_ROLL / segments);
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
    var showEdge = isHollowResult ? Math.round(data.edgeDistX || data.edgeDist) : Math.round(data.edgeDistX || data.edgeDist);
    line2 += ' &nbsp;|&nbsp; ' + t('iso_edge') + ': <b>' + showEdge + ' mm</b>';

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

    // Bredde: fordel symmetrisk innenfor stålsonen
    var cols, edgeDistX, spacingX;
    var steelEdgeX = Math.min(maxEdge, Math.floor(steelW / 4));
    var innerW = steelW - 2 * steelEdgeX;

    if (innerW <= 0 || steelW <= maxEdge * 2) {
        cols = 1;
        edgeDistX = steelW / 2;
        spacingX = 0;
    } else {
        cols = Math.max(2, Math.ceil(innerW / maxCC) + 1);
        edgeDistX = steelEdgeX;
        spacingX = innerW / (cols - 1);
    }

    // Høyde: fordel symmetrisk innenfor stålsonen
    var rows, edgeDistY, spacingY;
    var steelEdgeY = Math.min(maxEdge, Math.floor(steelH / 4));
    var innerH = steelH - 2 * steelEdgeY;

    if (innerH <= 0 || steelH <= maxEdge * 2) {
        rows = 1;
        edgeDistY = steelH / 2;
        spacingY = 0;
    } else {
        rows = Math.max(2, Math.ceil(innerH / maxRowCC) + 1);
        edgeDistY = steelEdgeY;
        spacingY = innerH / (rows - 1);
    }

    var edgeDist = maxEdge;

    var pins = [];

    if (!isHollow && method === 'pins') {
        var rightPinX = steelW - edgeDistX;
        if (rightPinX < edgeDistX) rightPinX = edgeDistX;
        for (var r = 0; r < rows; r++) {
            pins.push({ x: edgeDistX, y: edgeDistY + r * spacingY });
            if (rightPinX > edgeDistX) pins.push({ x: rightPinX, y: edgeDistY + r * spacingY });
        }
        spacingX = (rightPinX > edgeDistX) ? rightPinX - edgeDistX : 0;
    } else {
        for (var r = 0; r < rows; r++) {
            var y = edgeDistY + r * spacingY;
            for (var c = 0; c < cols; c++) {
                pins.push({ x: edgeDistX + c * spacingX, y: y });
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
        '<td><input type="number" inputmode="numeric" class="bp-dim-w" placeholder="—" oninput="bpCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" class="bp-dim-h" placeholder="—" oninput="bpCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" placeholder="—" oninput="bpCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" placeholder="—" oninput="bpCalc()"></td>' +
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
        var w = parseFloat(allInputs[0].value) || 0;
        var h = parseFloat(allInputs[1].value) || 0;
        var pipes = parseFloat(allInputs[2].value) || 0;
        var rounds = parseFloat(allInputs[3].value) || 0;

        // Round: π × d, Rectangular: 2 × (B + H)
        var perimeter = h > 0 ? 2 * (w + h) : Math.PI * w;
        var length = perimeter * pipes * rounds / 1000;

        var valSpan = rows[i].querySelector('.bp-result-val');
        if (w > 0 && pipes > 0 && rounds > 0) {
            valSpan.textContent = length.toFixed(2);
            valSpan.style.color = '';
            if (!isDisabled) total += length;
        } else {
            valSpan.textContent = '—';
            valSpan.style.color = (w === 0 && h === 0 && pipes === 0 && rounds === 0) ? '#ddd' : '';
        }
    }
    document.getElementById('bp-total-value').textContent = total.toFixed(2) + ' m';
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
                    '<tr class="la-hole-row"><td class="la-label">Utsp.</td><td><input type="number" inputmode="numeric" class="la-hole-w" placeholder="—" oninput="laCalc()"></td><td><input type="number" inputmode="numeric" class="la-hole-h" placeholder="—" oninput="laCalc()"></td><td class="la-result-cell"><span class="la-result-value">—</span></td></tr>' +
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
        '<td><input type="number" inputmode="numeric" class="la-pipe-w" placeholder="—" oninput="laCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" class="la-pipe-h" placeholder="—" oninput="laCalc()"></td>' +
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

function laReset() {
    document.getElementById('la-sections').innerHTML = '';
    _laSectionCount = 0;
    laAddSection();
}

function laCalc() {
    var sections = document.querySelectorAll('.la-section');
    for (var s = 0; s < sections.length; s++) {
        var holeW = parseFloat(sections[s].querySelector('.la-hole-w').value) || 0;
        var holeH = parseFloat(sections[s].querySelector('.la-hole-h').value) || 0;
        var holeSize = holeH > 0 ? Math.min(holeW, holeH) : holeW;

        var rows = sections[s].querySelectorAll('.la-pipe-rows tr');
        var totalPipeSize = 0;
        var hasPipes = false;

        for (var i = 0; i < rows.length; i++) {
            var pipeW = parseFloat(rows[i].querySelector('.la-pipe-w').value) || 0;
            var pipeH = parseFloat(rows[i].querySelector('.la-pipe-h').value) || 0;
            if (pipeW > 0) {
                totalPipeSize += pipeH > 0 ? Math.max(pipeW, pipeH) : pipeW;
                hasPipes = true;
            }
        }

        var resultEl = sections[s].querySelector('.la-result-value');
        if (holeSize > 0 && hasPipes) {
            var la = (holeSize - totalPipeSize) / 2;
            resultEl.textContent = la.toFixed(1);
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
        '<td><input type="number" inputmode="numeric" class="bpl-w" placeholder="—" oninput="bplCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" class="bpl-h" placeholder="—" oninput="bplCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" class="bpl-qty" placeholder="—" oninput="bplCalc()"></td>' +
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
    var w = parseFloat(document.getElementById('bpl-plate-w').value) || 1200;
    var h = parseFloat(document.getElementById('bpl-plate-h').value) || 600;
    var data = { w: w, h: h };
    localStorage.setItem('firesafe_plate_size', JSON.stringify(data));
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc('plateSize').set(data)
            .catch(function(e) { console.error('Save plate size error:', e); });
    }
    showNotificationModal('Standard platestørrelse lagret: ' + w + ' × ' + h + ' mm', true);
}

function bplCalc() {
    var rows = document.querySelectorAll('#bpl-rows tr');
    var totalPlates = 0;

    for (var i = 0; i < rows.length; i++) {
        var isDisabled = rows[i].classList.contains('bp-row-disabled');
        var w = parseFloat(rows[i].querySelector('.bpl-w').value) || 0;
        var h = parseFloat(rows[i].querySelector('.bpl-h').value) || 0;
        var qty = parseFloat(rows[i].querySelector('.bpl-qty').value) || 0;

        var plateW = parseFloat(document.getElementById('bpl-plate-w').value) || 0;
        var plateH = parseFloat(document.getElementById('bpl-plate-h').value) || 0;
        var plateArea = plateW * plateH;

        var area = w * h * qty;
        var valSpan = rows[i].querySelector('.bp-result-val');
        if (w > 0 && h > 0 && qty > 0 && plateArea > 0) {
            var plates = area / plateArea;
            valSpan.textContent = plates.toFixed(2);
            valSpan.style.color = '';
            if (!isDisabled) totalPlates += plates;
        } else {
            valSpan.textContent = '—';
            valSpan.style.color = (w === 0 && h === 0 && qty === 0) ? '#ddd' : '';
        }
    }

    document.getElementById('bpl-plate-count').textContent = totalPlates > 0 ? totalPlates.toFixed(2) : '0';
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

    // Uttak (sent service forms)
    var archived = safeParseJSON(SERVICE_ARCHIVE_KEY, []);
    for (var i2 = 0; i2 < archived.length; i2++) {
        var form = archived[i2];
        var entries = form.entries || [];
        for (var j = 0; j < entries.length; j++) {
            var entry = entries[j];
            if (!entry.materials || entry.materials.length === 0) continue;
            items.push({
                type: 'uttak',
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
        return;
    }

    var html = '';
    for (var i3 = 0; i3 < items.length; i3++) {
        var item = items[i3];
        var isPafylling = item.type === 'pafylling';
        var typeLabel = isPafylling ? t('bil_history_pafylling') : t('bil_history_uttak');
        var titleHtml = escapeHtml(item.dato);
        var subtitleHtml = '';
        if (isPafylling) {
            subtitleHtml = t('bil_add_pafylling').replace(/^\+\s*/, '');
        } else if (item.prosjektnr) {
            subtitleHtml = escapeHtml(item.prosjektnr) + (item.prosjektnavn ? '<span class="bil-history-sep"></span>' + escapeHtml(item.prosjektnavn) : '');
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
                var bilIsMeter = (m.enhet || '').toLowerCase() === 'meter';
                var bilUnit = bilIsMeter ? ' meter' : ' stk';
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
            if (!bilGroup.isSpecGroup) {
                for (var fi = 0; fi < bilGroup.items.length; fi++) {
                    var m = bilGroup.items[fi];
                    matsHtml += '<div class="bil-history-mat"><div class="mat-summary-row">'
                        + '<span class="mat-summary-name">' + escapeHtml(formatBilName(m)) + '</span>'
                        + '<span class="mat-summary-detail">' + buildBilDetail(m) + '</span>'
                        + '</div></div>';
                }
            } else {
                matsHtml += '<div class="bil-history-mat"><div class="bil-history-group-header">'
                    + escapeHtml(bilGroup.baseName.charAt(0).toUpperCase() + bilGroup.baseName.slice(1))
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
        html += '<div class="bil-history-card ' + (isPafylling ? 'bil-card-pafylling' : 'bil-card-uttak') + hiddenClass + '">' +
            '<div class="bil-history-header">' +
                '<span class="bil-history-type">' + typeLabel + '</span>' +
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
}

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

function openBilPafylling() {
    openMaterialPicker(null, function(materials) {
        if (materials.length > 0) {
            saveBilPafylling(materials);
        }
    });
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

    // Firebase sync
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid)
          .collection('bilPafylling').doc(record.id).set(record)
          .catch(function(e) { console.error('Bil påfylling Firebase error:', e); });
    }

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

        // Firebase sync
        if (currentUser && db) {
            db.collection('users').doc(currentUser.uid)
              .collection('bilPafylling').doc(id).delete()
              .catch(function(e) { console.error('Delete bil påfylling Firebase error:', e); });
        }

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
    setTimeout(function() { overlay.classList.remove('active'); }, 150);
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
        // Apply to kappe form — prosjekt + valgfri leveringsadresse
        if (template.prosjektnr) document.getElementById('kappe-prosjektnr').value = template.prosjektnr;
        if (template.prosjektnavn) document.getElementById('kappe-prosjektnavn').value = template.prosjektnavn;
        var kappeMap = {
            mottaker:   'kappe-mottaker',
            veiadresse: 'kappe-veiadresse',
            postnr:     'kappe-postnr',
            poststed:   'kappe-poststed',
            kontakt:    'kappe-kontakt',
            tlf:        'kappe-tlf'
        };
        var anyDelivery = false;
        for (var k in kappeMap) {
            if (template[k]) {
                var kel = document.getElementById(kappeMap[k]);
                if (kel) kel.value = template[k];
                anyDelivery = true;
            }
        }
        // Ekspander leveringsadresse-kortet hvis noen felter ble fylt ut
        if (anyDelivery) {
            var card = document.getElementById('kappe-delivery-card');
            if (card) {
                var wrap = card.querySelector('.mobile-order-body-wrap');
                if (wrap && !wrap.classList.contains('expanded')) {
                    var header = card.querySelector('.mobile-order-header');
                    if (header) toggleKappeDeliverySection(header);
                }
            }
        }
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

function openNewKappeForm() {
    document.body.classList.remove('template-modal-open');

    var defaults = safeParseJSON(KAPPE_DEFAULTS_KEY, {});
    _kappeCurrentId = null;

    function _kappeAutofill(field) {
        return (defaults['autofill_' + field] !== false) ? (defaults[field] || '') : '';
    }

    document.getElementById('kappe-dato').value = _kappeFormatDateNO(_kappeTodayISO());
    document.getElementById('kappe-onsket-leveringsdato').value = '';
    document.getElementById('kappe-avdeling').value = _kappeAutofill('avdeling');
    document.getElementById('kappe-bestiller').value = _kappeAutofill('bestiller');
    document.getElementById('kappe-prosjektnr').value = '';
    document.getElementById('kappe-prosjektnavn').value = '';
    document.getElementById('kappe-mottaker').value = _kappeAutofill('mottaker');
    document.getElementById('kappe-veiadresse').value = _kappeAutofill('veiadresse');
    document.getElementById('kappe-postnr').value = _kappeAutofill('postnr');
    document.getElementById('kappe-poststed').value = _kappeAutofill('poststed');
    document.getElementById('kappe-kontakt').value = _kappeAutofill('kontakt');
    document.getElementById('kappe-tlf').value = _kappeAutofill('tlf');
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

function _kappeProductOptionsHtml(selectedName) {
    var products = getKappeProducts();
    var hasSelection = !!selectedName && products.some(function(p) { return p.name === selectedName; });
    var html = '<option value="" disabled hidden' + (hasSelection ? '' : ' selected') + '>' + escapeHtml(t('kappe_product_placeholder')) + '</option>';
    for (var i = 0; i < products.length; i++) {
        var p = products[i];
        var sel = (p.name === selectedName) ? ' selected' : '';
        html += '<option value="' + escapeHtml(p.name) + '"' + sel + '>' + escapeHtml(p.name) + '</option>';
    }
    return html;
}

function _createKappeKappRow(kappData) {
    var d = kappData || {};
    var row = document.createElement('div');
    row.className = 'kappe-kapp-row';
    row.innerHTML =
        '<div class="kappe-triple-row">' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_bredde">Bredde (mm)</label>' +
                '<input type="text" class="kappe-line-bredde" inputmode="decimal" pattern="[0-9,.]*" value="' + escapeHtml(d.bredde || '') + '">' +
            '</div>' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_lopemeter">Løpemeter</label>' +
                '<input type="text" class="kappe-line-lopemeter" inputmode="decimal" pattern="[0-9,.]*" value="' + escapeHtml(d.lopemeter || d['løpemeter'] || '') + '">' +
            '</div>' +
            '<div class="mobile-field field-required">' +
                '<label data-i18n="kappe_col_antall_sider">Antall sider</label>' +
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
    var container = card.querySelector('.kappe-kapp-rows');
    if (container.querySelectorAll('.kappe-kapp-row').length <= 1) return;
    row.remove();
    _updateKappeKappRemoveStates(card);
    renumberKappeLines();
}

function _updateKappeKappRemoveStates(card) {
    var rows = card.querySelectorAll('.kappe-kapp-row');
    var btns = card.querySelectorAll('.kappe-kapp-remove-btn');
    btns.forEach(function(b) { b.disabled = rows.length <= 1; });
}

function _getKappeLineKappData(card) {
    var kapp = [];
    card.querySelectorAll('.kappe-kapp-row').forEach(function(row) {
        kapp.push({
            bredde: (row.querySelector('.kappe-line-bredde') || {}).value || '',
            lopemeter: (row.querySelector('.kappe-line-lopemeter') || {}).value || '',
            antallSider: (row.querySelector('.kappe-line-antall-sider') || {}).value || ''
        });
    });
    return kapp;
}

function createKappeLineCard(lineData, expanded) {
    var data = lineData || {};
    // Backward compat: old format had bredde/lopemeter/antallSider directly
    var kappList = data.kapp || [];
    if (!kappList.length) {
        if (data.bredde || data.lopemeter || data.antallSider) {
            kappList = [{ bredde: data.bredde || '', lopemeter: data.lopemeter || data['løpemeter'] || '', antallSider: data.antallSider || '' }];
        } else {
            kappList = [{}];
        }
    }

    var card = document.createElement('div');
    card.className = 'kappe-line-card mobile-order-card';

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
                '<select class="kappe-line-product">' + _kappeProductOptionsHtml(data.produkt || '') + '</select>' +
            '</div>' +
            '<div class="kappe-plate-row">' +
                '<div class="mobile-field">' +
                    '<label>' + t('kappe_plate_length') + '</label>' +
                    '<input type="text" class="kappe-line-plate-length" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(data.plateLengde || '1200') + '">' +
                '</div>' +
                '<div class="mobile-field">' +
                    '<label>' + t('kappe_plate_width') + '</label>' +
                    '<input type="text" class="kappe-line-plate-width" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(data.plateBredde || '1000') + '">' +
                '</div>' +
                '<div class="mobile-field">' +
                    '<label>' + t('kappe_plate_stack') + '</label>' +
                    '<input type="text" class="kappe-line-plate-stack" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(data.plateStabel || '1') + '">' +
                '</div>' +
            '</div>' +
            '<div class="kappe-kapp-rows"></div>' +
            '<button type="button" class="kappe-add-kapp-btn" onclick="addKappeKappRow(this)">+ ' + t('kappe_add_kapp') + '</button>' +
            '<div class="mobile-field">' +
                '<label data-i18n="kappe_col_merknad">' + t('kappe_col_merknad') + '</label>' +
                '<textarea class="kappe-line-merknad" rows="2">' + escapeHtml(data.merknad || '') + '</textarea>' +
            '</div>' +
        '</div>' +
        '</div>';

    var kappContainer = card.querySelector('.kappe-kapp-rows');
    kappList.forEach(function(k) {
        kappContainer.appendChild(_createKappeKappRow(k));
    });

    card.querySelector('.kappe-line-product').addEventListener('change', renumberKappeLines);
    _updateKappeKappRemoveStates(card);

    return card;
}

function addKappeLine() {
    var container = document.getElementById('kappe-lines');
    container.querySelectorAll('.kappe-line-card').forEach(function(card) {
        var wrap = card.querySelector('.mobile-order-body-wrap');
        if (wrap && wrap.classList.contains('expanded')) {
            wrap.classList.remove('expanded');
            card.querySelector('.mobile-order-arrow').innerHTML = '&#9660;';
        }
    });
    var card = createKappeLineCard({}, true);
    container.appendChild(card);
    updateKappeDeleteStates();
    renumberKappeLines();
    sessionStorage.setItem('firesafe_kappe_current', JSON.stringify(getKappeFormData()));
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

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
        var kappCount = card.querySelectorAll('.kappe-kapp-row').length;
        var bits = ['#' + (idx + 1)];
        if (prod && prod.value) bits.push(prod.value);
        if (kappCount > 1) bits.push(kappCount + ' kapp');
        card.querySelector('.kappe-line-title').textContent = bits.join(' · ');
    });
}

function updateKappeDeleteStates() {
    var cards = document.querySelectorAll('#kappe-lines .kappe-line-card');
    var delBtns = document.querySelectorAll('#kappe-lines .mobile-order-header-delete');
    delBtns.forEach(function(btn) { btn.disabled = cards.length <= 1; });
}

function _kappeStiftRowHtml(size, value) {
    return '<div class="kappe-stift-row" data-row-size="' + escapeHtml(size) + '">' +
        '<label class="kappe-stift-label">' + escapeHtml(size) + '</label>' +
        '<input type="text" class="kappe-stift-input" data-size="' + escapeHtml(size) + '" inputmode="numeric" placeholder="Antall krt" value="' + escapeHtml(value || '') + '">' +
        '<button type="button" class="kappe-stift-remove" onclick="removeKappeStiftRow(this)" aria-label="Fjern">' + deleteIcon + '</button>' +
    '</div>';
}

function renderKappeStiftRows(existing) {
    var container = document.getElementById('kappe-stift');
    if (!container) return;
    var html = '';
    (existing || []).forEach(function(s) {
        var size = s.storrelse || s['størrelse'];
        if (!size) return;
        html += _kappeStiftRowHtml(size, s.antall);
    });
    container.innerHTML = html;
    _updateKappeStiftAddBtnState();
}

function _updateKappeStiftAddBtnState() {
    var btn = document.getElementById('kappe-stift-add');
    if (!btn) return;
    var used = Array.prototype.map.call(
        document.querySelectorAll('#kappe-stift .kappe-stift-row'),
        function(r) { return r.getAttribute('data-row-size'); }
    );
    btn.disabled = used.length >= getKappeStiftSizes().length;
}

function openKappeStiftPicker() {
    // Samle eksisterende verdier så picker kan pre-fylle
    var currentValues = {};
    document.querySelectorAll('#kappe-stift .kappe-stift-row').forEach(function(row) {
        var size = row.getAttribute('data-row-size');
        var input = row.querySelector('.kappe-stift-input');
        currentValues[size] = input ? input.value : '';
    });

    var popup = document.getElementById('action-popup');
    var titleEl = document.getElementById('action-popup-title');
    titleEl.textContent = t('kappe_stift_pick');
    titleEl.style.display = '';
    var buttonsEl = document.getElementById('action-popup-buttons');
    var listHtml = '<div class="kappe-stift-picker-list">';
    getKappeStiftSizes().forEach(function(size) {
        var val = currentValues[size] || '';
        listHtml += '<div class="kappe-stift-picker-row">' +
            '<label class="kappe-stift-picker-label">' + escapeHtml(size) + '</label>' +
            '<input type="text" class="kappe-stift-picker-input" data-size="' + escapeHtml(size) + '" inputmode="numeric" placeholder="Antall krt" value="' + escapeHtml(val) + '">' +
        '</div>';
    });
    listHtml += '</div>';
    buttonsEl.innerHTML = listHtml +
        '<div class="confirm-modal-buttons" style="margin-top:12px">' +
            '<button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button>' +
            '<button class="confirm-btn-ok" style="flex:1;background:#E8501A" onclick="applyKappeStiftPicker()">OK</button>' +
        '</div>';
    popup.classList.add('active');
    // Auto-focus første tomme felt
    requestAnimationFrame(function() {
        var firstEmpty = buttonsEl.querySelector('.kappe-stift-picker-input:placeholder-shown') || buttonsEl.querySelector('.kappe-stift-picker-input');
        if (firstEmpty) firstEmpty.focus();
    });
}

function applyKappeStiftPicker() {
    var container = document.getElementById('kappe-stift');
    if (!container) return;
    var picker = document.querySelectorAll('#action-popup .kappe-stift-picker-input');
    var newRows = '';
    picker.forEach(function(inp) {
        var size = inp.getAttribute('data-size');
        var v = (inp.value || '').trim();
        if (!size || !v) return;
        newRows += _kappeStiftRowHtml(size, v);
    });
    container.innerHTML = newRows;
    _updateKappeStiftAddBtnState();
    closeActionPopup();
}

function addKappeStiftRow(size) {
    var container = document.getElementById('kappe-stift');
    if (!container) return;
    if (container.querySelector('[data-row-size="' + size + '"]')) return;
    container.insertAdjacentHTML('beforeend', _kappeStiftRowHtml(size, ''));
    _updateKappeStiftAddBtnState();
    var input = container.querySelector('[data-row-size="' + size + '"] .kappe-stift-input');
    if (input) input.focus();
}

function removeKappeStiftRow(btn) {
    var row = btn.closest('.kappe-stift-row');
    if (row) row.remove();
    _updateKappeStiftAddBtnState();
}

function getKappeFormData() {
    var lines = [];
    document.querySelectorAll('#kappe-lines .kappe-line-card').forEach(function(card) {
        lines.push({
            produkt: (card.querySelector('.kappe-line-product') || {}).value || '',
            plateLengde: (card.querySelector('.kappe-line-plate-length') || {}).value || '1200',
            plateBredde: (card.querySelector('.kappe-line-plate-width') || {}).value || '1000',
            plateStabel: (card.querySelector('.kappe-line-plate-stack') || {}).value || '1',
            kapp: _getKappeLineKappData(card),
            merknad: (card.querySelector('.kappe-line-merknad') || {}).value || ''
        });
    });
    var stift = [];
    document.querySelectorAll('#kappe-stift .kappe-stift-input').forEach(function(inp) {
        var v = inp.value || '';
        if (v) stift.push({ storrelse: inp.getAttribute('data-size'), antall: v });
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
    document.getElementById('kappe-bestiller').value = data.bestiller || '';
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
    list.forEach(function(line) { container.appendChild(createKappeLineCard(line, list.length === 1)); });
    renumberKappeLines();
    updateKappeDeleteStates();
    renderKappeStiftRows(data.stift || []);
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
    var stiftSection = document.querySelector('.mobile-section-title[data-i18n="kappe_section_staples"]');
    if (stiftSection) {
        if (req.stift === true) stiftSection.classList.add('field-required');
        else stiftSection.classList.remove('field-required');
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
        if (!anyLine) {
            showNotificationModal(t('kappe_validation_no_lines'));
            return false;
        }
    }
    if (req.stift === true) {
        var stiftRows = document.querySelectorAll('#kappe-stift .kappe-stift-row');
        if (!stiftRows.length) {
            showNotificationModal(t('kappe_validation_no_stift'));
            return false;
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
    } catch(e) {
        console.error('Mark kappe as sent error:', e);
    }
}

function loadKappeTab() {
    var cachedSaved = safeParseJSON(KAPPE_STORAGE_KEY, []);
    var cachedSent = safeParseJSON(KAPPE_ARCHIVE_KEY, []);
    var cachedForms = cachedSaved.map(function(f) { return Object.assign({}, f, { _isSent: false }); })
        .concat(cachedSent.map(function(f) { return Object.assign({}, f, { _isSent: true }); }))
        .sort(function(a, b) {
            if (a._isSent !== b._isSent) return a._isSent ? 1 : -1;
            return (b.savedAt || '').localeCompare(a.savedAt || '');
        });
    renderKappeFormsList(cachedForms);
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
        return;
    }
    window.loadedKappeForms = forms;
    listEl.innerHTML = forms.map(function(item, i) { return _buildKappeItemHtml(item, i); }).join('');
    listEl.querySelectorAll('.saved-item').forEach(function(el, i) { el._formData = window.loadedKappeForms[i]; });
}

function loadKappeFormDirect(formData) {
    if (!formData) return;
    document.body.classList.remove('saved-modal-open');
    sessionStorage.removeItem('firesafe_hent_tab');

    _kappeCurrentId = formData.id || null;
    setKappeFormData(formData);

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
        var list = safeParseJSON(lsKey, []);
        var idx = list.findIndex(function(f) { return f.id === formData.id; });
        if (idx !== -1) { list.splice(idx, 1); safeSetItem(lsKey, JSON.stringify(list)); }
        var loadedIdx = (window.loadedKappeForms || []).findIndex(function(f) { return f.id === formData.id; });
        if (loadedIdx !== -1) window.loadedKappeForms.splice(loadedIdx, 1);
        renderKappeFormsList(window.loadedKappeForms);
        _lastLocalSaveTs = Date.now();
    });
}

// Event delegation for kappe-list items
(function() {
    var kappeListEl = document.getElementById('kappe-list');
    if (!kappeListEl) return;
    kappeListEl.addEventListener('click', function(e) {
        var item = e.target.closest('.saved-item');
        if (!item) return;
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

function _calcKappeWN630(bredde, lopemeter, antallSider, plateLengde, plateBredde, kerf, stabel) {
    var w = parseFloat(bredde) || 0;
    var lm = parseFloat(lopemeter) || 0;
    var sider = parseFloat(antallSider) || 0;
    var pL = parseFloat(plateLengde) || 1200;
    var pB = parseFloat(plateBredde) || 1000;
    var k = parseFloat(kerf) || 2;
    var stabelAntall = Math.max(1, parseInt(stabel) || 1);

    var empty = { langs: [], kerf: k, stabel: stabelAntall };
    if (w <= 0 || lm <= 0 || sider <= 0) return empty;

    var totalLm = lm * sider;

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
            kuttLangsMm: kuttDim,
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

    // Sorter: minst svinn per plate først
    langs.sort(function(a, b) { return a.svinnPerPlate - b.svinnPerPlate; });

    return { langs: langs, kerf: k, stabel: stabelAntall };
}

// ─── Kappe export ───────────────────────────────────────────────────────────

function buildKappeExportTable() {
    var data = getKappeFormData();
    var container = document.getElementById('kappe-export-container');

    var lines = (data.lines || []).slice();

    var lev = data.leveringsadresse || {};

    function fmtNum(v) {
        if (!v) return '';
        return String(v).replace('.', ',');
    }

    var headerHtml =
        '<div class="ke-header">' +
            '<div class="ke-logo">FIRESAFE<span class="ke-logo-slash"></span></div>' +
            '<div class="ke-title">KAPPESKJEMA</div>' +
            '<div class="ke-meta">' +
                '<div><strong>Dato:</strong> ' + escapeHtml(data.dato || '') + '</div>' +
                '<div><strong>Ønsket lev.:</strong> ' + escapeHtml(_kappeFormatDateNO(data.onsketLeveringsdato) || '') + '</div>' +
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
                '<div class="ke-info-row"><span>Pallemerking:</span><span>' + escapeHtml(data.pallemerking || '') + '</span></div>' +
            '</div>' +
            '<div class="ke-info-col">' +
                '<div class="ke-info-col-title">Leveringsadresse</div>' +
                '<div class="ke-info-row"><span>Mottaker:</span><span>' + escapeHtml(lev.mottaker || '') + '</span></div>' +
                '<div class="ke-info-row"><span>Veiadresse:</span><span>' + escapeHtml(lev.veiadresse || '') + '</span></div>' +
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
        var pL = l.plateLengde || '1200';
        var pB = l.plateBredde || '1000';
        var pS = l.plateStabel || '1';
        // Backward compat: old format had bredde/lopemeter/antallSider directly
        var kappArr = l.kapp || [];
        if (!kappArr.length) {
            kappArr = [{ bredde: l.bredde || '', lopemeter: l.lopemeter || '', antallSider: l.antallSider || '' }];
        }
        for (var ki = 0; ki < kappArr.length; ki++) {
            var ka = kappArr[ki];
            var wn630 = _calcKappeWN630(ka.bredde, ka.lopemeter, ka.antallSider, pL, pB, kerf, pS);
            var best = wn630.langs.length ? wn630.langs[0] : null;
            flatRows.push({
                nr: ki === 0 ? (i + 1) : '',
                produkt: ki === 0 ? (l.produkt || '') : '',
                bredde: ka.bredde || '',
                lopemeter: ka.lopemeter || '',
                antallSider: ka.antallSider || '',
                merknad: (ki === 0) ? (l.merknad || '') : '',
                wn630: wn630,
                totaltM2: best ? (best.antallStk * best.stripLengde * (parseFloat(ka.bredde) / 1000)) : ''
            });
        }
    }

    var productRows = '';
    for (var ri = 0; ri < flatRows.length; ri++) {
        var r = flatRows[ri];
        var nrContent = r.nr;
        if (r.merknad) nrContent += (r.nr ? '. ' : '') + '<span class="ke-merknad">' + escapeHtml(r.merknad) + '</span>';

        // WN630 celle: vis begge orienteringer
        var wn630Html = '';
        if (r.wn630 && r.wn630.langs.length) {
            var stab = r.wn630.stabel;
            for (var oi = 0; oi < r.wn630.langs.length; oi++) {
                var o = r.wn630.langs[oi];
                if (oi > 0) wn630Html += '<div class="ke-wn630-sep"></div>';
                wn630Html += '<div class="ke-wn630-row">' +
                    '<strong>' + o.antallStk + ' stk</strong>' +
                    (stab > 1 ? ' (' + o.antallKapp + ' kapp)' : '') +
                    ' · ' + o.kuttLangsMm + 'mm · ' +
                    o.stripes + '/plate · rest ' + o.svinnPerPlate + 'mm' +
                '</div>';
            }
        }

        productRows +=
            '<tr>' +
                '<td class="ke-td-nr">' + nrContent + '</td>' +
                '<td class="ke-td-produkt">' + escapeHtml(r.produkt) + '</td>' +
                '<td class="ke-td-bredde">' + escapeHtml(fmtNum(r.bredde)) + '</td>' +
                '<td class="ke-td-lm">' + escapeHtml(fmtNum(r.lopemeter)) + '</td>' +
                '<td class="ke-td-antall-sider">' + escapeHtml(fmtNum(r.antallSider)) + '</td>' +
                '<td class="ke-td-wn630">' + wn630Html + '</td>' +
                '<td>' + (r.totaltM2 ? fmtNum(r.totaltM2.toFixed(2)) : '') + '</td>' +
                '<td>' + (r.totaltM2 ? fmtNum((r.totaltM2 * 1.10).toFixed(2)) : '') + '</td>' +
            '</tr>';
    }

    var productsTable =
        '<div class="ke-section-title">Kappeliste</div>' +
        '<table class="ke-products-table">' +
            '<colgroup>' +
                '<col style="width:22%">' +
                '<col style="width:12%">' +
                '<col style="width:5%">' +
                '<col style="width:5%">' +
                '<col style="width:4%">' +
                '<col style="width:34%">' +
                '<col style="width:5%">' +
                '<col style="width:13%">' +
            '</colgroup>' +
            '<thead>' +
                '<tr>' +
                    '<th>#</th>' +
                    '<th>Produkt</th>' +
                    '<th>Bredde<br>(mm)</th>' +
                    '<th>Løpe&shy;meter</th>' +
                    '<th>Ant.<br>sider</th>' +
                    '<th>Antall stk WN630</th>' +
                    '<th>Totalt<br>m²</th>' +
                    '<th>Veiledende m²<br>(inkl. svinn)</th>' +
                '</tr>' +
            '</thead>' +
            '<tbody>' + productRows + '</tbody>' +
        '</table>' +
        '<div class="ke-kerf-note">Beregnet med bladbredde ' + kerf + 'mm</div>';

    var stiftMap = {};
    (data.stift || []).forEach(function(s) { stiftMap[s.storrelse || s['størrelse']] = s.antall; });
    var stiftRows = '';
    getKappeStiftSizes().forEach(function(size) {
        stiftRows +=
            '<tr>' +
                '<td class="ke-stift-size">' + escapeHtml(size) + '</td>' +
                '<td class="ke-stift-antall">' + escapeHtml(stiftMap[size] || '') + '</td>' +
            '</tr>';
    });

    var stiftTable =
        '<div class="ke-section-title">Stift</div>' +
        '<table class="ke-stift-table">' +
            '<colgroup><col style="width:55%"><col style="width:45%"></colgroup>' +
            '<thead><tr><th>Størrelse</th><th>Antall krt</th></tr></thead>' +
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
    var base = 'kappeskjema';
    if (data.prosjektnr) base += '_' + data.prosjektnr;
    else if (data.prosjektnavn) base += '_' + data.prosjektnavn.replace(/[^A-Za-z0-9æøåÆØÅ_-]/g, '_');
    return base + '.' + ext;
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

async function doKappeSharePDF() {
    if (!validateKappeRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderKappeToCanvas();
        var pdf = _createPdfFromCanvas(canvas, 297, 210, 'JPEG', 0.95);
        var blob = pdf.output('blob');
        var file = new File([blob], getKappeExportFilename('pdf'), { type: 'application/pdf' });
        await navigator.share({ files: [file] });
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doKappeSharePNG() {
    if (!validateKappeRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderKappeToCanvas();
        var dataUrl = canvas.toDataURL('image/png');
        var res = await fetch(dataUrl);
        var blob = await res.blob();
        var file = new File([blob], getKappeExportFilename('png'), { type: 'image/png' });
        await navigator.share({ files: [file] });
    } catch (e) {
        if (e.name !== 'AbortError') showNotificationModal(t('share_error') + e.message);
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
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doKappeSharePDF(); closeActionPopup()">' + shareIcon + ' PDF</button>'
        : '<button class="confirm-btn-ok" style="background:#E8501A;opacity:0.5;cursor:not-allowed" onclick="showNotificationModal(t(\'share_not_supported\'))">' + shareIcon + ' PDF</button>';
    var shareBtnPNG = canShare
        ? '<button class="confirm-btn-ok" style="background:#E8501A" onclick="doKappeSharePNG(); closeActionPopup()">' + shareIcon + ' PNG</button>'
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
    document.getElementById('preview-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';

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

    var header = document.querySelector('.preview-overlay-header');
    var cs = getComputedStyle(scroll);
    var padLR = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var availWidth = scroll.clientWidth - padLR;
    var scale = Math.min(availWidth / 1250, 1);

    if (scale < 1) {
        container.style.transformOrigin = 'top left';
        container.style.transform = 'scale(' + scale + ')';
        container.style.marginBottom = (-(container.offsetHeight * (1 - scale))) + 'px';
        container.style.marginRight = (-(container.offsetWidth * (1 - scale))) + 'px';
        container.style.marginLeft = '';
        if (header) { header.style.maxWidth = (container.offsetWidth * scale) + 'px'; header.style.margin = '0'; }
    } else {
        container.style.transform = '';
        container.style.transformOrigin = '';
        container.style.marginLeft = 'auto';
        container.style.marginRight = 'auto';
        container.style.marginBottom = '';
        if (header) { header.style.maxWidth = '1250px'; header.style.margin = '0 auto'; }
    }
    window._previewBaseScale = scale;
    window._previewCurrentScale = scale;
}

// ─── Kappe product settings CRUD ───────────────────────────────────────────

function _kappeSettingsItemHtml(name, idx, editFn, removeFn) {
    return '<div class="settings-list-item kappe-product-item" data-idx="' + idx + '">' +
        '<div class="settings-list-item-main">' +
            '<div class="settings-list-item-name">' + escapeHtml(name) + '</div>' +
        '</div>' +
        '<div class="settings-list-item-actions">' +
            '<button type="button" class="settings-item-edit" onclick="' + editFn + '(' + idx + ')" title="' + t('edit_btn') + '">' + (typeof editIcon !== 'undefined' ? editIcon : '✏️') + '</button>' +
            '<button type="button" class="settings-item-remove" onclick="' + removeFn + '(' + idx + ')" title="' + t('delete_btn') + '">' + deleteIcon + '</button>' +
        '</div>' +
    '</div>';
}

function renderKappeProductSettings() {
    var container = document.getElementById('settings-kappe-product-items');
    if (!container) return;
    var products = getKappeProducts();
    var countEl = document.getElementById('settings-count-kappe-products');
    if (countEl) countEl.textContent = products.length ? '(' + products.length + ')' : '';
    if (!products.length) {
        container.innerHTML = '<div class="no-saved">' + t('kappe_settings_no_products') + '</div>';
        return;
    }
    container.innerHTML = products.map(function(p, i) {
        return _kappeSettingsItemHtml(p.name, i, 'editKappeProduct', 'removeKappeProduct');
    }).join('');
}

function addKappeProduct() {
    var nameEl = document.getElementById('settings-new-kappe-product');
    if (!nameEl) return;
    var name = (nameEl.value || '').trim();
    if (!name) { showNotificationModal(t('kappe_settings_name_required')); nameEl.focus(); return; }

    var products = getKappeProducts();
    if (products.some(function(p) { return p.name.toLowerCase() === name.toLowerCase(); })) {
        showNotificationModal(t('kappe_settings_duplicate'));
        return;
    }
    products.push({ name: name });
    products.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
    safeSetItem(KAPPE_PRODUCTS_KEY, JSON.stringify({ products: products }));
    nameEl.value = '';
    renderKappeProductSettings();
}

function editKappeProduct(idx) {
    var products = getKappeProducts();
    var p = products[idx];
    if (!p) return;
    var newName = prompt(t('kappe_settings_edit_name'), p.name);
    if (newName === null) return;
    newName = newName.trim();
    if (!newName) return;
    if (products.some(function(other, i) { return i !== idx && other.name.toLowerCase() === newName.toLowerCase(); })) {
        showNotificationModal(t('kappe_settings_duplicate'));
        return;
    }
    products[idx] = { name: newName };
    products.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
    safeSetItem(KAPPE_PRODUCTS_KEY, JSON.stringify({ products: products }));
    renderKappeProductSettings();
}

function removeKappeProduct(idx) {
    var products = getKappeProducts();
    var p = products[idx];
    if (!p) return;
    showConfirmModal(t('kappe_settings_remove_confirm') + ' "' + p.name + '"?', function() {
        products.splice(idx, 1);
        safeSetItem(KAPPE_PRODUCTS_KEY, JSON.stringify({ products: products }));
        renderKappeProductSettings();
    }, t('btn_remove'), '#e74c3c');
}

// --- Stift-størrelser CRUD ---

function _saveKappeStiftSizes(sizes) {
    safeSetItem(KAPPE_STIFT_SIZES_KEY, JSON.stringify({ sizes: sizes }));
}

function renderKappeStiftSizeSettings() {
    var container = document.getElementById('settings-kappe-stift-items');
    if (!container) return;
    var sizes = getKappeStiftSizes();
    var countEl = document.getElementById('settings-count-kappe-stift');
    if (countEl) countEl.textContent = sizes.length ? '(' + sizes.length + ')' : '';
    if (!sizes.length) {
        container.innerHTML = '<div class="no-saved">' + t('kappe_settings_no_stift') + '</div>';
        return;
    }
    container.innerHTML = sizes.map(function(size, i) {
        return _kappeSettingsItemHtml(size, i, 'editKappeStiftSize', 'removeKappeStiftSize');
    }).join('');
}

function addKappeStiftSize() {
    var el = document.getElementById('settings-new-kappe-stift');
    if (!el) return;
    var value = (el.value || '').trim();
    if (!value) { showNotificationModal(t('kappe_settings_stift_required')); el.focus(); return; }
    var sizes = getKappeStiftSizes();
    if (sizes.some(function(s) { return s.toLowerCase() === value.toLowerCase(); })) {
        showNotificationModal(t('kappe_settings_duplicate'));
        return;
    }
    sizes.push(value);
    _saveKappeStiftSizes(sizes);
    el.value = '';
    renderKappeStiftSizeSettings();
}

function editKappeStiftSize(idx) {
    var sizes = getKappeStiftSizes();
    var cur = sizes[idx];
    if (cur === undefined) return;
    var newVal = prompt(t('kappe_settings_edit_stift'), cur);
    if (newVal === null) return;
    newVal = newVal.trim();
    if (!newVal) return;
    if (sizes.some(function(s, i) { return i !== idx && s.toLowerCase() === newVal.toLowerCase(); })) {
        showNotificationModal(t('kappe_settings_duplicate'));
        return;
    }
    sizes[idx] = newVal;
    _saveKappeStiftSizes(sizes);
    renderKappeStiftSizeSettings();
}

function removeKappeStiftSize(idx) {
    var sizes = getKappeStiftSizes();
    var cur = sizes[idx];
    if (cur === undefined) return;
    showConfirmModal(t('kappe_settings_remove_confirm') + ' "' + cur + '"?', function() {
        sizes.splice(idx, 1);
        _saveKappeStiftSizes(sizes);
        renderKappeStiftSizeSettings();
    }, t('btn_remove'), '#e74c3c');
}

function _loadKappeKerfSetting() {
    var el = document.getElementById('settings-kappe-kerf');
    if (!el) return;
    el.value = getKappeKerf();
    el.addEventListener('change', function() {
        var v = parseFloat(el.value.replace(',', '.'));
        if (isNaN(v) || v < 0) v = KAPPE_DEFAULT_KERF;
        el.value = v;
        safeSetItem(KAPPE_KERF_KEY, JSON.stringify({ kerf: v }));
    });
}
