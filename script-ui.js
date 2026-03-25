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
        renderBilHistory();
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
    if (target.classList.contains('active')) return;
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

function closeAllModals() {
    var actionPopup = document.getElementById('action-popup');
    if (actionPopup) actionPopup.classList.remove('active');
    document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'service-view-open', 'calculator-modal-open');
    sessionStorage.removeItem('firesafe_settings_page');
    sessionStorage.removeItem('firesafe_form_type');
    sessionStorage.removeItem('firesafe_hent_tab');
    sessionStorage.removeItem('firesafe_defaults_tab');
    sessionStorage.removeItem('firesafe_service_current');
    showView('view-form');
}

function isModalOpen() {
    return document.body.classList.contains('template-modal-open')
        || document.body.classList.contains('saved-modal-open')
        || document.body.classList.contains('settings-modal-open')
        || document.body.classList.contains('service-view-open')
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
    var copyBtn = '<button class="saved-item-action-btn copy" title="' + t('duplicate_btn') + '">' + copyIcon + '</button>';
    var deleteBtn = isSent
        ? '<button class="saved-item-action-btn delete disabled" title="' + t('delete_btn') + '">' + deleteIcon + '</button>'
        : '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>';
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-row1">' + dot + (escapeHtml(ordrenr) || t('no_name')) + '</div>' +
            (dato ? '<div class="saved-item-date">' + escapeHtml(dato) + '</div>' : '') +
        '</div>' +
        '<div class="saved-item-buttons">' + copyBtn + deleteBtn + '</div>' +
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
    await duplicateFormDirect(form);
}

async function duplicateFormDirect(form) {
    if (!form) return;

    setFormData(form);
    // Tøm ordrenummer og sett nytt
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    autoFillOrderNumber();

    // Sett uke og dato basert på autofyll-innstillinger
    const now = new Date();
    const flags = getAutofillFlags();
    if (flags.uke) {
        const week = 'Uke ' + getWeekNumber(now);
        document.getElementById('dato').value = week;
        document.getElementById('mobile-dato').value = week;
    }
    if (flags.dato) {
        const today = formatDate(now);
        document.getElementById('signering-dato').value = today;
        document.getElementById('mobile-signering-dato').value = today;
    }

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
    // Reset to own tab
    switchHentTab('own');
    sessionStorage.removeItem('firesafe_hent_tab');
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function switchHentTab(tab) {
    sessionStorage.setItem('firesafe_hent_tab', tab);
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const serviceList = document.getElementById('service-list');
    const ownSearch = document.getElementById('own-search-wrap');
    const serviceSearch = document.getElementById('service-search-wrap');

    savedList.style.display = 'none';
    serviceList.style.display = 'none';
    ownSearch.style.display = 'none';
    serviceSearch.style.display = 'none';

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
    // From service view: go back to home
    if (currentId === 'service-view') {
        closeServiceView();
        showTemplateModal();
        return;
    }
    // From Skjemaer: close and go to form
    if (currentId === 'saved-modal') {
        closeModal();
        return;
    }
    // From Innstillinger: close and go to form
    if (currentId === 'settings-modal') {
        closeSettingsModal();
        return;
    }
    // From Calculator: go home
    if (currentId === 'calculator-modal') {
        document.body.classList.remove('calculator-modal-open');
        showTemplateModal();
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

    var cs = getComputedStyle(scroll);
    var padLR = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var availWidth = scroll.clientWidth - padLR;
    var scale = Math.min(availWidth / 800, 1);

    var header = document.querySelector('.preview-overlay-header');

    if (scale < 1) {
        fc.style.transformOrigin = 'top left';
        fc.style.transform = 'scale(' + scale + ')';
        fc.style.marginBottom = (-(fc.offsetHeight * (1 - scale))) + 'px';
        fc.style.marginRight = (-(fc.offsetWidth * (1 - scale))) + 'px';
        fc.style.marginLeft = '';
        if (header) {
            header.style.maxWidth = (fc.offsetWidth * scale) + 'px';
            header.style.margin = '0';
        }
    } else {
        fc.style.transform = '';
        fc.style.transformOrigin = '';
        fc.style.marginLeft = 'auto';
        fc.style.marginRight = 'auto';
        fc.style.marginBottom = '';
        if (header) {
            header.style.maxWidth = '800px';
            header.style.margin = '0 auto';
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

    // Recalculate on browser zoom / window resize
    window._previewResizeHandler = updatePreviewScale;
    window.addEventListener('resize', window._previewResizeHandler);
}

function closePreview() {
    // Remove resize listener
    if (window._previewResizeHandler) {
        window.removeEventListener('resize', window._previewResizeHandler);
        window._previewResizeHandler = null;
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
        sc.style.transform = '';
        sc.style.transformOrigin = '';
        sc.style.margin = '';
        sc.style.marginBottom = '';
        sc.style.marginLeft = '';
        sc.style.marginRight = '';
        sc.style.position = '';
        sc.style.top = '';
        sc.style.left = '';
        sc.style.height = '';
        sc.style.overflow = '';
        var scroll = document.getElementById('preview-scroll');
        scroll.style.position = '';
        scroll.style.height = '';
        scroll.style.overflowX = '';
        if (scroll._rotatedScrollHandler) {
            scroll.removeEventListener('scroll', scroll._rotatedScrollHandler);
            scroll._rotatedScrollHandler = null;
        }
        window._servicePreviewActive = false;
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
    let html = checkboxHtml +
        '<div class="confirm-modal-buttons">' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doExportPDF(document.getElementById(\'export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PDF</button>' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doExportPNG(document.getElementById(\'export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PNG</button>' +
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
                return (f.ordreseddelNr || '').toLowerCase().startsWith(term);
            });
            renderSavedFormsList(filtered);
            // Søk i Firestore etter ulastede skjemaer
            if ((_savedHasMore || _sentHasMore) && currentUser && db) {
                var ver = ++_searchVersion;
                firestoreSearchForms(rawTerm, [
                    { name: 'forms', isSent: false },
                    { name: 'archive', isSent: true }
                ]).then(function(fsResults) {
                    if (ver !== _searchVersion) return;
                    var merged = mergeSearchResults(filtered, fsResults);
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

function showTemplateModal() {
    closeAllModals();
    history.replaceState(null, '', window.location.pathname);

    showView('template-modal');
    document.body.classList.add('template-modal-open');
    updateToolbarState();
    renderBilHistory();
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
    document.getElementById('settings-page-' + page).style.display = 'block';
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
    if (page === 'materials' && !isAdmin) {
        pageEl.classList.add('settings-readonly');
    } else {
        pageEl.classList.remove('settings-readonly');
    }

    if (page === 'ordrenr') {
        document.getElementById('settings-new-start').value = '';
        document.getElementById('settings-new-end').value = '';
        document.getElementById('settings-give-start').value = '';
        document.getElementById('settings-give-end').value = '';
        // Show cached immediately
        _applyOrderNrSettings(_getCachedOrderNrSettings());
        // Background refresh
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
        // Background refresh
        getRequiredSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open')) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('save');
                renderRequiredSettingsItems('service');
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
        // Show cached immediately
        var cachedMat = localStorage.getItem(MATERIALS_KEY);
        var cachedData = normalizeMaterialData(cachedMat ? JSON.parse(cachedMat) : null);
        settingsMaterials = cachedData.materials.slice();
        settingsMaterials.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
        renderMaterialSettingsItems();
        document.getElementById('settings-new-material').value = '';
        document.getElementById('settings-new-material-type').value = 'standard';
        document.getElementById('settings-new-material-singular').value = '';
        document.getElementById('settings-new-material-plural').value = '';
        updateSettingsUnitFields();
        // Background refresh
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
                service: Object.assign({}, defaults.service, data.service || {})
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
    if (!arr || arr.length === 0) {
        return defaultUnit ? [{ singular: defaultUnit, plural: defaultUnit }] : [];
    }
    return arr.map(function(u) {
        if (typeof u === 'string') return { singular: u, plural: u };
        return { singular: u.singular || u.plural || '', plural: u.plural || u.singular || '' };
    });
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
    // Remember which groups were expanded (preserved during edits)
    const expandedSet = new Set();
    container.querySelectorAll('.settings-material-group.expanded').forEach(el => {
        const name = el.querySelector('.settings-material-name');
        if (name) expandedSet.add(name.textContent);
    });
    container.innerHTML = settingsMaterials.map((item, idx) => {
        const unitLocked = item.type !== 'standard';
        const units = unitLocked ? [{ singular: 'stk', plural: 'stk' }] : (item.allowedUnits && item.allowedUnits.length > 0 ? item.allowedUnits : (item.defaultUnit ? [{ singular: item.defaultUnit, plural: item.defaultUnit }] : []));
        const defaultUnit = item.defaultUnit || '';
        const unitsHtml = units.map((u, ui) => {
            const label = typeof u === 'string' ? u : (u.singular && u.singular !== u.plural ? u.singular + ' / ' + u.plural : u.plural);
            const unitPlural = typeof u === 'string' ? u : u.plural;
            const isDefault = units.length === 1 || unitPlural === defaultUnit;
            const starIcon = isDefault ? '<span class="settings-material-unit-star">★</span>' : '<span class="settings-material-unit-star empty">☆</span>';
            const removeBtn = unitLocked ? '' : `<button class="settings-material-unit-remove" onclick="event.stopPropagation();removeMaterialUnit(${idx},${ui})">&times;</button>`;
            const setDefaultClick = unitLocked ? '' : `event.stopPropagation();setDefaultUnit(${idx},${ui})`;
            const editClick = unitLocked ? '' : `editMaterialUnit(${idx},${ui},this)`;
            return `<div class="settings-material-unit-item">
                <span class="settings-material-unit-default" onclick="${setDefaultClick}">${starIcon}</span>
                <span class="settings-material-unit-text" onclick="${editClick}">${escapeHtml(label)}</span>${removeBtn}</div>`;
        }).join('');
        const addRow = unitLocked ? '' : `<div class="settings-material-unit-add" onclick="addMaterialUnit(${idx})">+ Legg til enhet</div>`;
        // Summary line for collapsed state — show default unit (singular form)
        var defaultSingular = '';
        if (defaultUnit && units.length > 0) {
            var defUnit = units.find(function(u) { return (typeof u === 'string' ? u : u.plural) === defaultUnit; });
            defaultSingular = defUnit ? (defUnit.singular || defUnit.plural || defUnit) : defaultUnit;
        } else if (units.length > 0) {
            defaultSingular = units[0].singular || units[0].plural || units[0];
        }
        const summaryText = defaultSingular || 'Ingen enheter';
        const isExpanded = expandedSet.has(item.name);
        const matType = item.type || 'standard';
        return `<div class="settings-material-group${isExpanded ? ' expanded' : ''}">
            <div class="settings-material-header" onclick="toggleMaterialExpand(this)">
                <span class="settings-material-name" onclick="event.stopPropagation();editSettingsMaterial(${idx})">${escapeHtml(item.name)}</span>
                <button class="settings-material-type-btn" onclick="event.stopPropagation();openMatTypeDropdown(this,${idx})" data-value="${matType}">${t('material_type_' + matType)}</button>
                <button class="settings-delete-btn" onclick="event.stopPropagation();removeSettingsMaterial(${idx})" title="${t('btn_remove')}">${deleteIcon}</button>
                <span class="settings-material-expand">&rsaquo;</span>
            </div>
            <div class="settings-material-summary" onclick="toggleMaterialExpand(this.previousElementSibling)">${escapeHtml(summaryText)}</div>
            <div class="settings-material-body">${unitsHtml}${addRow}</div>
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
    const inputS = document.createElement('input');
    inputS.type = 'text';
    inputS.placeholder = 'Entall';
    inputS.autocapitalize = 'sentences';
    const inputP = document.createElement('input');
    inputP.type = 'text';
    inputP.placeholder = 'Flertall';
    inputP.autocapitalize = 'sentences';
    editRow.appendChild(inputS);
    editRow.appendChild(inputP);
    addRow.before(editRow);
    inputS.focus();
    editRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    let saved = false;
    function save(e) {
        if (saved) return;
        // Don't save if focus moved to sibling input
        if (e && (e.relatedTarget === inputS || e.relatedTarget === inputP)) return;
        saved = true;
        const singular = inputS.value.trim();
        const plural = inputP.value.trim();
        if (plural && !mat.allowedUnits.some(u => (typeof u === 'string' ? u : u.plural).toLowerCase() === plural.toLowerCase())) {
            mat.allowedUnits.push({ singular: singular || plural, plural: plural });
            if (!mat.defaultUnit) mat.defaultUnit = plural;
            saveMaterialSettings();
        }
        renderMaterialSettingsItems();
    }
    inputS.addEventListener('blur', save);
    inputP.addEventListener('blur', save);
    function handleKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); if (e.target === inputS) inputP.focus(); else inputP.blur(); }
        if (e.key === 'Escape') { saved = true; renderMaterialSettingsItems(); }
    }
    inputS.addEventListener('keydown', handleKey);
    inputP.addEventListener('keydown', handleKey);
}

function editMaterialUnit(idx, unitIdx, itemEl) {
    if (!isAdmin) return;
    const mat = settingsMaterials[idx];
    const units = mat.allowedUnits || [];
    const oldUnit = units[unitIdx] || { singular: '', plural: '' };
    const oldS = typeof oldUnit === 'string' ? oldUnit : oldUnit.singular;
    const oldP = typeof oldUnit === 'string' ? oldUnit : oldUnit.plural;

    const editRow = document.createElement('div');
    editRow.className = 'settings-material-unit-edit';
    const inputS = document.createElement('input');
    inputS.type = 'text';
    inputS.value = oldS;
    inputS.placeholder = 'Entall';
    const inputP = document.createElement('input');
    inputP.type = 'text';
    inputP.value = oldP;
    inputP.placeholder = 'Flertall';
    editRow.appendChild(inputS);
    editRow.appendChild(inputP);
    itemEl.replaceWith(editRow);
    inputS.focus();
    inputS.select();

    let saved = false;
    function save(e) {
        if (saved) return;
        if (e && (e.relatedTarget === inputS || e.relatedTarget === inputP)) return;
        saved = true;
        const singular = inputS.value.trim();
        const plural = inputP.value.trim();
        if (plural && (singular !== oldS || plural !== oldP)) {
            if (!mat.allowedUnits) mat.allowedUnits = units.slice();
            mat.allowedUnits[unitIdx] = { singular: singular || plural, plural: plural };
            if (unitIdx === 0) mat.defaultUnit = plural;
            saveMaterialSettings();
        }
        renderMaterialSettingsItems();
    }
    inputS.addEventListener('blur', save);
    inputP.addEventListener('blur', save);
    function handleKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); if (e.target === inputS) inputP.focus(); else inputP.blur(); }
        if (e.key === 'Escape') { saved = true; renderMaterialSettingsItems(); }
    }
    inputS.addEventListener('keydown', handleKey);
    inputP.addEventListener('keydown', handleKey);
}

function setDefaultUnit(idx, unitIdx) {
    if (!isAdmin) return;
    const mat = settingsMaterials[idx];
    if (!mat.allowedUnits || !mat.allowedUnits[unitIdx]) return;
    const u = mat.allowedUnits[unitIdx];
    mat.defaultUnit = (typeof u === 'string' ? u : u.plural) || '';
    renderMaterialSettingsItems();
    saveMaterialSettings();
}

function removeMaterialUnit(idx, unitIdx) {
    if (!isAdmin) return;
    const mat = settingsMaterials[idx];
    if (!mat.allowedUnits || mat.allowedUnits.length <= 1) return;
    mat.allowedUnits.splice(unitIdx, 1);
    const first = mat.allowedUnits[0];
    mat.defaultUnit = (typeof first === 'string' ? first : first.plural) || '';
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
    var singular = document.getElementById('settings-new-material-singular');
    var plural = document.getElementById('settings-new-material-plural');
    var fixedUnit = type !== 'standard';
    if (fixedUnit) {
        singular.value = 'stk';
        plural.value = 'stk';
        singular.disabled = true;
        plural.disabled = true;
    } else {
        if (singular.value === 'stk' && singular.disabled) singular.value = '';
        if (plural.value === 'stk' && plural.disabled) plural.value = '';
        singular.disabled = false;
        plural.disabled = false;
    }
}

async function addSettingsMaterial() {
    if (!isAdmin) return;
    const input = document.getElementById('settings-new-material');
    const singularInput = document.getElementById('settings-new-material-singular');
    const pluralInput = document.getElementById('settings-new-material-plural');
    const val = input.value.trim();
    const typeSelect = document.getElementById('settings-new-material-type');
    const type = typeSelect.value;
    const singular = singularInput.value.trim();
    const plural = pluralInput.value.trim();
    const needsUnit = type === 'standard';

    // Validate all required fields
    if (!val || (needsUnit && (!singular || !plural))) {
        if (!val) input.classList.add('settings-input-error');
        if (needsUnit && !singular) singularInput.classList.add('settings-input-error');
        if (needsUnit && !plural) pluralInput.classList.add('settings-input-error');
        setTimeout(() => {
            input.classList.remove('settings-input-error');
            singularInput.classList.remove('settings-input-error');
            pluralInput.classList.remove('settings-input-error');
        }, 1500);
        return;
    }
    if (settingsMaterials.some(m => m.name.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_material_exists'));
        return;
    }
    const allowedUnits = [];
    let defaultUnit = '';
    if (singular || plural) {
        const unitObj = { singular: singular || plural, plural: plural || singular };
        allowedUnits.push(unitObj);
        defaultUnit = unitObj.plural;
    }
    if (type !== 'standard') {
        defaultUnit = 'stk';
        allowedUnits.length = 0;
        allowedUnits.push({ singular: 'stk', plural: 'stk' });
    }
    settingsMaterials.push({ name: val, type: type, defaultUnit: defaultUnit, allowedUnits: allowedUnits });
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    input.value = '';
    singularInput.value = '';
    pluralInput.value = '';
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
    const span = item.querySelector('.settings-material-name') || item.querySelector('span');
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
            newSpan.className = 'settings-material-name';
            newSpan.textContent = oldVal;
            newSpan.setAttribute('onclick', 'event.stopPropagation();editSettingsMaterial(' + idx + ')');
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
                    service: { ...defaults.service, ...(data.service || {}) }
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
                service: { ...defaults.service, ...(data.service || {}) }
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
}

function switchRequiredTab(tab) {
    // Toggle tab active state
    var tabs = document.querySelectorAll('#settings-page-required .settings-tab');
    tabs.forEach(function(t, i) {
        t.classList.toggle('active', (tab === 'own' && i === 0) || (tab === 'service' && i === 1));
    });

    // Toggle content
    var ownContent = document.getElementById('required-own-content');
    var serviceContent = document.getElementById('required-service-content');
    if (ownContent) ownContent.style.display = tab === 'own' ? '' : 'none';
    if (serviceContent) serviceContent.style.display = tab === 'service' ? '' : 'none';

    if (tab === 'service') {
        renderRequiredSettingsItems('service');
    }
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
                duplicateBtn + copyIcon + '</button>' +
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
}

// ============================================
// STANDARDVERDIER (AUTOFYLL)
// ============================================

const DEFAULT_FIELDS = ['montor', 'avdeling', 'sted'];

var _defaultsTab = 'own';

async function getDefaultSettings(tab) {
    var isService = tab === 'service';
    var fbDoc = isService ? 'defaults_service' : 'defaults';
    var storageKey = isService ? SERVICE_DEFAULTS_KEY : DEFAULTS_KEY;
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

    // Save ordreseddel defaults
    var defaults = {};
    DEFAULT_FIELDS.forEach(field => {
        var val = document.getElementById('default-' + field).value.trim();
        if (val) defaults[field] = val;
    });
    var key = DEFAULTS_KEY;
    var fbDoc = 'defaults';
    var existing = safeParseJSON(key, {});
    ['autofill_uke', 'autofill_dato', 'autofill_sted'].forEach(function(k) {
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
}

function switchDefaultsTab(tab) {
    _defaultsTab = tab;
    sessionStorage.setItem('firesafe_defaults_tab', tab);

    // Toggle tab active state
    var tabs = document.querySelectorAll('#settings-page-defaults .settings-tab');
    tabs.forEach(function(t, i) {
        t.classList.toggle('active', (tab === 'own' && i === 0) || (tab === 'service' && i === 1));
    });

    // Toggle content
    var ownContent = document.getElementById('defaults-own-content');
    var serviceContent = document.getElementById('defaults-service-content');
    if (ownContent) ownContent.style.display = tab === 'own' ? '' : 'none';
    if (serviceContent) serviceContent.style.display = tab === 'service' ? '' : 'none';

    loadDefaultsForTab(tab);
}

function _applyDefaultsToUI(defaults, tab) {
    if (!tab || tab === 'own') {
        DEFAULT_FIELDS.forEach(function(field) {
            var input = document.getElementById('default-' + field);
            if (input) {
                input.value = defaults[field] || '';
                defaultsInitialValues[field] = input.value;
            }
        });
        ['uke', 'dato', 'sted'].forEach(function(key) {
            var cb = document.getElementById('autofill-' + key);
            if (cb) cb.checked = defaults['autofill_' + key] !== false;
        });
    } else if (tab === 'service') {
        var montorEl = document.getElementById('default-service-montor');
        if (montorEl) montorEl.value = defaults.montor || '';
        var datoEl = document.getElementById('autofill-service-dato');
        if (datoEl) datoEl.checked = defaults.autofill_dato !== false;
    }
}

function loadDefaultsForTab(tab) {
    var storageKey = tab === 'service' ? SERVICE_DEFAULTS_KEY : DEFAULTS_KEY;
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
            if (field === 'sted' && defaults.autofill_sted === false) return;
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
        uke: defaults.autofill_uke !== false,
        dato: defaults.autofill_dato !== false,
        sted: defaults.autofill_sted !== false
    };
}

function saveAutofillToggle(key, value, type) {
    var isService = type === 'service' || _defaultsTab === 'service';
    var storageKey = isService ? SERVICE_DEFAULTS_KEY : DEFAULTS_KEY;
    var fbDoc = isService ? 'defaults_service' : 'defaults';
    var stored = localStorage.getItem(storageKey);
    var defaults = stored ? JSON.parse(stored) : {};
    defaults['autofill_' + key] = value;
    safeSetItem(storageKey, JSON.stringify(defaults));

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


function hasUnsavedChanges() {
    const currentData = getFormDataSnapshot();
    return lastSavedData !== null
        ? currentData !== lastSavedData
        : hasAnyFormData();
}

function isOnFormPage() {
    return !document.getElementById('saved-modal').classList.contains('active')
        && !document.getElementById('settings-modal').classList.contains('active')
        && !document.getElementById('template-modal').classList.contains('active')
        && !document.getElementById('service-view').classList.contains('active');
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
    if (flags.dato) {
        const today = formatDate(now);
        document.getElementById('signering-dato').value = today;
        document.getElementById('mobile-signering-dato').value = today;
    }
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

    // Sett uke og dato basert på autofyll-innstillinger
    var now = new Date();
    var flags = getAutofillFlags();
    if (flags.uke) {
        var week = 'Uke ' + getWeekNumber(now);
        document.getElementById('dato').value = week;
        document.getElementById('mobile-dato').value = week;
    }
    if (flags.dato) {
        var today = formatDate(now);
        document.getElementById('signering-dato').value = today;
        document.getElementById('mobile-signering-dato').value = today;
    }

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

// Felles canvas-rendering for eksport/deling
async function renderFormToCanvas() {
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

    return canvas;
}

function getExportFilename(ext) {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value || 'ukjent';
    const dato = document.getElementById('dato').value.replace(/\./g, '-') || formatDate(new Date()).replace(/\./g, '-');
    return `ordreseddel_${ordrenr}_${dato}.${ext}`;
}

async function doExportPDF(markSent) {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, imgHeight);
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

    // Show service view
    showView('service-view');
    document.body.classList.add('service-view-open');
    window.location.hash = 'service';
    document.getElementById('service-sent-banner').style.display = 'none';
    document.getElementById('btn-service-sent').style.display = '';
    document.getElementById('service-save-btn').disabled = false;
    sessionStorage.removeItem('firesafe_service_sent');
    _serviceLastSavedData = null;
    sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));

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
        _serviceLastSavedData = JSON.stringify(data);
        _lastLocalSaveTs = Date.now();

        // Clear sent state
        sessionStorage.removeItem('firesafe_service_sent');
        document.getElementById('service-sent-banner').style.display = 'none';
        document.getElementById('btn-service-sent').style.display = '';

        showNotificationModal(t('service_save_success'), true);
        sessionStorage.setItem('firesafe_service_current', JSON.stringify(data));
        closeServiceView();
        _showSavedFormsDirectly('service');

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
                .sort(function(a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
            if (document.body.classList.contains('saved-modal-open')) {
                renderServiceFormsList(allForms);
            }
        }).catch(function(e) { console.error('Refresh service forms:', e); });
    }
}

function _buildServiceItemHtml(item, index) {
    // Build title from first entry's dato: "Uke X • DD.MM.YYYY"
    var entryDato = item.entries && item.entries[0] ? item.entries[0].dato : '';
    var title = '';
    if (entryDato) {
        var d = parseDateDMY(entryDato);
        if (d) {
            title = 'Uke ' + getWeekNumber(d) + ' \u2022 ' + entryDato;
        } else {
            title = entryDato;
        }
    }
    var savedAtStr = formatDateWithTime(item.savedAt);
    var isSent = item._isSent;
    var dot = '<span class="status-dot ' + (isSent ? 'sent' : 'saved') + '"></span>';
    var copyBtn = '<button class="saved-item-action-btn copy" title="' + t('duplicate_btn') + '">' + copyIcon + '</button>';
    var deleteBtn = isSent
        ? '<button class="saved-item-action-btn delete disabled" title="' + t('delete_btn') + '">' + deleteIcon + '</button>'
        : '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>';
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-row1">' + dot + escapeHtml(title || t('no_name')) + '</div>' +
            (savedAtStr ? '<div class="saved-item-date">' + escapeHtml(savedAtStr) + '</div>' : '') +
        '</div>' +
        '<div class="saved-item-buttons">' + copyBtn + deleteBtn + '</div>' +
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
    _serviceLastSavedData = JSON.stringify(formData);
    sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
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
    _serviceLastSavedData = null;
    sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
    window.scrollTo(0, 0);
    showNotificationModal(t('duplicated_success'), true);
}

function deleteServiceForm(formData) {
    if (!formData) return;
    var isSent = formData._isSent;
    showConfirmModal(t('delete_confirm'), function() {
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
        _serviceLastSavedData = JSON.stringify(data);
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
    buttonsEl.innerHTML = checkboxHtml +
        '<div class="confirm-modal-buttons">' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doServiceExportPDF(document.getElementById(\'service-export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PDF</button>' +
            '<button class="confirm-btn-ok" style="background:#333" onclick="doServiceExportPNG(document.getElementById(\'service-export-mark-sent\')?.checked); closeActionPopup()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PNG</button>' +
        '</div>';
    popup.classList.add('active');
}

function buildServiceExportTable() {
    var data = getServiceFormData();
    var container = document.getElementById('service-export-container');

    // Get ALL materials from settings (not just used ones)
    var allMats = cachedMaterialOptions || [];
    var matNames = allMats.map(function(m) {
        return m.name ? m.name.charAt(0).toUpperCase() + m.name.slice(1) : '';
    });

    // 7 columns per row, minimum 2 rows, expands if more materials
    var matCols = 5;
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
                if (m.name.toLowerCase().startsWith(baseName.toLowerCase() + ' ')) {
                    var pipeInfo = getRunningMeterInfo(m.name);
                    var pipes = parseFloat((m.antall || '').replace(',', '.'));
                    var spec = m.name.substring(baseName.length + 1);
                    if (hasLM && pipeInfo && !isNaN(pipes) && pipes > 0) {
                        // Mansjett/Brannpakning: show only running meters
                        var lm = calculateRunningMeters(pipeInfo, pipes);
                        lines.push(formatRunningMeters(lm) + ' meter');
                    } else {
                        // Kabelhylse: show spec + antall + enhet on one line
                        var text = '';
                        if (spec) text += escapeHtml(spec);
                        if (m.antall) text += ' ' + escapeHtml((m.antall || '').replace('.', ',')) + ' ' + escapeHtml(m.enhet || 'stk');
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
                    matched.push(escapeHtml((m.antall || '').replace('.', ',')) + ' ' + escapeHtml(m.enhet || ''));
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
        ? '<img id="service-export-sig-img" src="' + data.signatureImage + '" style="height:40px;">'
        : '<img id="service-export-sig-img" style="display:none;height:40px;">';

    // Colgroup for consistent column widths
    var colgroup = '<colgroup>';
    colgroup += '<col style="width:7%">'; // Dato
    colgroup += '<col style="width:7%">'; // Prosjekt nr
    colgroup += '<col style="width:10%">'; // Prosjektnavn
    for (var c = 0; c < matCols; c++) {
        colgroup += '<col>';
    }
    colgroup += '</colgroup>';

    // Header: 2 rows — title rowspan=2, montør row 1, signatur row 2
    var headerRow =
        '<tr>' +
            '<td rowspan="2" colspan="3" class="se-title-cell"><strong>Lageruttak Servicebiler</strong></td>' +
            '<td class="se-montor-label">Navn montør:</td>' +
            '<td colspan="' + (matCols - 1) + '" class="se-montor-value">' + escapeHtml(data.montor) + '</td>' +
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
    var container = buildServiceExportTable();
    container.style.display = 'block';
    container.style.width = '800px';

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
    });

    window._previewResizeHandler = updateServicePreviewScale;
    window.addEventListener('resize', window._previewResizeHandler);
}

function updateServicePreviewScale() {
    var overlay = document.getElementById('preview-overlay');
    if (!overlay || !overlay.classList.contains('active')) return;

    var container = document.getElementById('service-export-container');
    var scroll = document.getElementById('preview-scroll');
    if (!container || !scroll) return;

    var header = document.querySelector('.preview-overlay-header');
    var headerHeight = header ? header.offsetHeight : 0;
    var scrollWidth = scroll.clientWidth;
    var scrollHeight = window.innerHeight - headerHeight;

    if (scrollWidth < 800) {
        // Portrait: rotate to landscape, scale width (800px) to fit viewport height
        var contentHeight = container.offsetHeight;
        var scale = Math.min(scrollHeight / 800, 1);
        var scaledW = 800 * scale;
        var scaledH = contentHeight * scale;

        // How much rotated content extends beyond screen width
        var overflow = Math.max(0, scaledH - scrollWidth);

        container.style.transformOrigin = 'top left';
        container.style.position = 'relative';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '800px';
        // DOM height = viewport + overflow → provides scroll range for panning
        container.style.height = (scrollHeight + overflow) + 'px';
        container.style.overflow = 'visible';

        // Prevent horizontal scroll from the 800px DOM width
        scroll.style.overflowX = 'hidden';

        // Scroll-driven panning: vertical scroll pans horizontally through rotated sections
        function onRotatedScroll() {
            var scrollPx = scroll.scrollTop;
            // translate Y compensates for scroll so table stays vertically fixed
            // translate X pans through sections based on scroll position
            container.style.transform = 'translate(' + (-scrollPx) + 'px, ' + (scaledW + scrollPx) + 'px) rotate(-90deg) scale(' + scale + ')';
        }

        onRotatedScroll();

        // Attach scroll handler (cleanup old one first)
        if (scroll._rotatedScrollHandler) {
            scroll.removeEventListener('scroll', scroll._rotatedScrollHandler);
        }
        scroll._rotatedScrollHandler = onRotatedScroll;
        scroll.addEventListener('scroll', onRotatedScroll);

        if (header) {
            header.style.maxWidth = scrollWidth + 'px';
            header.style.margin = '0';
        }
    } else {
        // Desktop: scale normally
        var cs = getComputedStyle(scroll);
        var padLR = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        var availWidth = scrollWidth - padLR;
        var scale = Math.min(availWidth / 800, 1);

        container.style.position = '';
        container.style.left = '';
        container.style.top = '';
        container.style.height = '';
        scroll.style.position = '';
        scroll.style.height = '';
        scroll.style.overflowX = '';

        // Remove rotated scroll handler if present
        if (scroll._rotatedScrollHandler) {
            scroll.removeEventListener('scroll', scroll._rotatedScrollHandler);
            scroll._rotatedScrollHandler = null;
        }

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
                header.style.maxWidth = '800px';
                header.style.margin = '0 auto';
            }
        }
    }
}

async function renderServiceToCanvas() {
    var container = buildServiceExportTable();
    container.style.display = 'block';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '800px';
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
    var montor = (document.getElementById('service-montor').value || 'service').replace(/\s+/g, '_');
    var dato = formatDate(new Date()).replace(/\./g, '-');
    return 'lageruttak_' + montor + '_' + dato + '.' + ext;
}

async function doServiceExportPDF(markSent) {
    if (!validateServiceRequiredFields()) return;
    var loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        var canvas = await renderServiceToCanvas();
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF('l', 'mm', 'a4'); // landscape
        var imgWidth = 297; // A4 landscape width
        var imgHeight = (canvas.height * imgWidth) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, imgHeight);
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

// Background click handler removed - saved-modal is now a view, not an overlay

// Event delegation for saved-list items
document.getElementById('saved-list').addEventListener('click', function(e) {
    const savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    // Get form data directly from the element
    const formData = savedItem._formData;
    if (!formData) return;

    // Check if click was on a button
    const btn = e.target.closest('button');
    if (btn) {
        e.stopPropagation();
        if (btn.classList.contains('disabled')) return;
        if (btn.classList.contains('copy')) {
            duplicateFormDirect(savedItem._formData);
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

    var btn = e.target.closest('button');
    if (btn) {
        if (btn.classList.contains('disabled')) return;
        e.stopPropagation();
        if (btn.classList.contains('delete')) {
            deleteServiceForm(formData);
        } else if (btn.classList.contains('copy')) {
            duplicateServiceForm(formData);
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
    // Alltid sett signering-dato til dagens dato og tøm kundens underskrift ved oppstart
    const today = formatDate(new Date());
    document.getElementById('signering-dato').value = today;
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-signering-dato').value = today;
    document.getElementById('mobile-kundens-underskrift').value = '';

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

    // Load dropdown options for materials/units
    getDropdownOptions();

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
                _serviceLastSavedData = serviceCurrent;
                var wasSent = sessionStorage.getItem('firesafe_service_sent') === '1';
                document.getElementById('service-sent-banner').style.display = wasSent ? 'block' : 'none';
                document.getElementById('btn-service-sent').style.display = wasSent ? 'none' : '';
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
window.addEventListener('hashchange', function() {
    if (!currentUser) return; // Ikke naviger uten innlogging
    const hash = window.location.hash.slice(1);
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
    } else if (hash === 'calc') {
        if (!document.body.classList.contains('calculator-modal-open')) {
            _showCalculatorDirectly();
        }
    } else {
        // No hash = home = template modal
        showTemplateModal();
    }
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
    updateToolbarState();
}

function showCalcPage(page) {
    document.querySelector('.calc-section').style.display = 'none';
    document.querySelectorAll('.calc-page').forEach(function(p) { p.style.display = 'none'; });
    var pageEl = document.getElementById('calc-page-' + page);
    if (pageEl) pageEl.style.display = '';
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
        // Init with one row if empty
        var container = document.getElementById('bp-rows');
        if (container.children.length === 0) bpAddRow();
    }
}

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

function bpAddRow() {
    _bpRowCount++;
    var tbody = document.getElementById('bp-rows');
    var tr = document.createElement('tr');
    tr.id = 'bp-row-' + _bpRowCount;
    tr.innerHTML =
        '<td><input type="number" inputmode="numeric" class="bp-dim-w" oninput="bpCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" class="bp-dim-h" oninput="bpCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" value="1" oninput="bpCalc()"></td>' +
        '<td><input type="number" inputmode="numeric" value="1" oninput="bpCalc()"></td>' +
        '<td class="bp-result-cell"><span class="bp-result-val">—</span></td>';
    tbody.appendChild(tr);
    // Auto-remove row when Ø/B is cleared and blurred
    tr.querySelector('.bp-dim-w').addEventListener('blur', function() {
        var allRows = document.querySelectorAll('#bp-rows tr');
        if (allRows.length > 1 && !this.value) {
            this.closest('tr').remove();
            bpCalc();
        }
    });
    bpCalc();
    tr.querySelector('input').focus();
}

function bpCalc() {
    var rows = document.querySelectorAll('#bp-rows tr');
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
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
            total += length;
        } else {
            valSpan.textContent = '—';
            valSpan.style.color = '#ddd';
        }
    }
    document.getElementById('bp-total-value').textContent = total.toFixed(2) + ' m';
}

// ===== Bil (Vehicle Inventory) =====

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
        var title = isPafylling
            ? item.dato
            : (item.prosjektnr ? item.prosjektnr + (item.prosjektnavn ? ' \u2014 ' + item.prosjektnavn : '') : item.dato);

        var matsHtml = '';
        for (var j2 = 0; j2 < item.materials.length; j2++) {
            var m = item.materials[j2];
            matsHtml += '<div class="bil-history-mat">' + escapeHtml(m.name) + ' ' + escapeHtml(m.antall || '0') + ' ' + escapeHtml(m.enhet || '') + '</div>';
        }

        var deleteBtn = isPafylling
            ? '<button class="bil-history-delete" onclick="deleteBilPafylling(\'' + item.id + '\')" title="Slett">' + deleteIcon + '</button>'
            : '';

        var hiddenClass = i3 >= 3 ? ' bil-history-hidden' : '';
        html += '<div class="bil-history-card ' + (isPafylling ? 'bil-card-pafylling' : 'bil-card-uttak') + hiddenClass + '">' +
            '<div class="bil-history-header">' +
                '<span class="bil-history-type">' + typeLabel + '</span>' +
                '<span class="bil-history-title">' + escapeHtml(title) + '</span>' +
                deleteBtn +
            '</div>' +
            '<div class="bil-history-materials">' + matsHtml + '</div>' +
        '</div>';
    }

    if (items.length > 3) {
        var remaining = items.length - 3;
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

function openServiceTemplatePicker(btn) {
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

    if (_serviceTemplateTargetCard) {
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
