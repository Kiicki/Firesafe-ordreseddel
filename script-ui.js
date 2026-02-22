// Cache for loaded forms (to use with index-based functions)
// Use window scope to ensure consistency
if (!window.loadedForms) window.loadedForms = [];
if (!window.loadedExternalForms) window.loadedExternalForms = [];
var preNewFormData = null;

// Pagination cursors for "Load more"
var _savedLastDoc = null, _sentLastDoc = null, _savedHasMore = false, _sentHasMore = false;
var _extLastDoc = null, _extSentLastDoc = null, _extHasMore = false, _extSentHasMore = false;
var _templateLastDoc = null, _templateHasMore = false;
var _lastLocalSaveTs = 0;
var _pendingFirestoreOps = Promise.resolve();

function resetPaginationState() {
    _savedLastDoc = null; _sentLastDoc = null;
    _savedHasMore = false; _sentHasMore = false;
    _extLastDoc = null; _extSentLastDoc = null;
    _extHasMore = false; _extSentHasMore = false;
    _templateLastDoc = null; _templateHasMore = false;
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
function showView(viewId) {
    var target = document.getElementById(viewId);
    if (target.classList.contains('active')) return;
    document.querySelectorAll('.view').forEach(function(v) {
        v.classList.remove('active');
    });
    target.classList.add('active');
}

function closeAllModals() {
    var actionPopup = document.getElementById('action-popup');
    if (actionPopup) actionPopup.classList.remove('active');
    document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
    sessionStorage.removeItem('firesafe_settings_page');
    showView('view-form');
}

function isModalOpen() {
    return document.body.classList.contains('template-modal-open')
        || document.body.classList.contains('saved-modal-open')
        || document.body.classList.contains('settings-modal-open');
}

// Update toolbar button states based on current view
function updateToolbarState() {
    const isOnForm = !document.body.classList.contains('template-modal-open')
                  && !document.body.classList.contains('saved-modal-open')
                  && !document.body.classList.contains('settings-modal-open');

    const saveBtn = document.querySelector('.btn-save');
    if (saveBtn) {
        saveBtn.disabled = !isOnForm;
    }

    const exportBtn = document.querySelector('.btn-export');
    if (exportBtn) {
        exportBtn.disabled = !isOnForm;
    }
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
    return result.sort(function(a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
}

function _showSavedFormsDirectly() {
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
    document.getElementById('external-list').scrollTop = 0;

    switchHentTab(isExternalForm ? 'external' : 'own');

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

    // Disable save button
    var headerSaveBtn = document.querySelector('.btn-save');
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

    // Disable form type tabs
    var formTypeTabs = document.getElementById('form-type-tabs');
    if (formTypeTabs) formTypeTabs.classList.toggle('disabled', readOnly);
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
    var headerDoneBtn = document.getElementById('header-done-btn');
    if (headerDoneBtn) headerDoneBtn.style.display = isSent ? 'none' : '';
    sessionStorage.setItem('firesafe_current_sent', isSent ? '1' : '');
    closeModal();
    // Set hash based on form type
    window.location.hash = isExternalForm ? 'ekstern' : 'skjema';
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
    isExternalForm = false;
    updateFormTypeChip();
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
    // Duplicated form is always regular (not external)
    window.location.hash = 'skjema';
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
    document.getElementById('external-search').value = '';
    // Reset to own tab
    switchHentTab('own');
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function switchHentTab(tab) {
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const externalList = document.getElementById('external-list');
    const ownSearch = document.getElementById('own-search-wrap');
    const externalSearch = document.getElementById('external-search-wrap');

    savedList.style.display = 'none';
    externalList.style.display = 'none';
    ownSearch.style.display = 'none';
    externalSearch.style.display = 'none';

    if (tab === 'own') {
        tabs[0].classList.add('active');
        savedList.style.display = '';
        ownSearch.style.display = '';
        savedList.scrollTop = 0;
    } else if (tab === 'external') {
        tabs[1].classList.add('active');
        externalList.style.display = '';
        externalSearch.style.display = '';
        externalList.scrollTop = 0;
        loadExternalTab();
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
    } else if (type === 'external') {
        var extForm = window.loadedExternalForms[index];
        if (extForm) title = extForm.ordreseddelNr || '';
        actions.push({ label: t('delete_btn'), onclick: 'deleteExternalForm(null, ' + index + ')' });
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
var _externalFormsAll = null;
var _templatesAll = null;

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
        } else if (listId === 'external-list') {
            if (!_externalFormsAll) _externalFormsAll = window.loadedExternalForms ? window.loadedExternalForms.slice() : [];
            if (!term) { var all2 = _externalFormsAll; _externalFormsAll = null; renderExternalFormsList(all2, false, _extHasMore || _extSentHasMore); return; }
            var filtered2 = _externalFormsAll.filter(function(f) {
                return (f.ordreseddelNr || '').toLowerCase().startsWith(term);
            });
            renderExternalFormsList(filtered2);
            // Søk i Firestore etter ulastede eksterne skjemaer
            if ((_extHasMore || _extSentHasMore) && currentUser && db) {
                var ver2 = ++_searchVersion;
                firestoreSearchForms(rawTerm, [
                    { name: 'external', isSent: false },
                    { name: 'externalArchive', isSent: true }
                ]).then(function(fsResults) {
                    if (ver2 !== _searchVersion) return;
                    var merged = mergeSearchResults(filtered2, fsResults);
                    if (merged.length > filtered2.length) {
                        renderExternalFormsList(merged);
                    }
                });
            }
        } else if (listId === 'template-list') {
            if (!_templatesAll) _templatesAll = window.loadedTemplates ? window.loadedTemplates.slice() : [];
            if (!term) { var all3 = _templatesAll; _templatesAll = null; renderTemplateList(all3, false, _templateHasMore); return; }
            var filtered3 = _templatesAll.filter(function(f) {
                return (f.prosjektnavn || '').toLowerCase().startsWith(term);
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
        }
    }, 150);
}

function moveCurrentToSaved() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const formsCol = isExternalForm ? 'external' : 'forms';
    const archiveCol = isExternalForm ? 'externalArchive' : 'archive';
    const sKey = isExternalForm ? EXTERNAL_KEY : STORAGE_KEY;
    const aKey = isExternalForm ? EXTERNAL_ARCHIVE_KEY : ARCHIVE_KEY;

    // localStorage first (optimistic)
    var archived = safeParseJSON(aKey, []);
    var formIndex = archived.findIndex(function(f) { return f.ordreseddelNr === ordrenr; });
    var formId = (formIndex !== -1) ? archived[formIndex].id : null;
    if (formIndex !== -1) {
        var saved = safeParseJSON(sKey, []);
        var movedForm = archived.splice(formIndex, 1)[0];
        saved.unshift(movedForm);
        safeSetItem(aKey, JSON.stringify(archived));
        safeSetItem(sKey, JSON.stringify(saved));
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
        var formsCollection = isExternalForm ? 'external' : 'forms';
        var archiveCollection = isExternalForm ? 'externalArchive' : 'archive';
        var storageKey = isExternalForm ? EXTERNAL_KEY : STORAGE_KEY;
        var archiveKey = isExternalForm ? EXTERNAL_ARCHIVE_KEY : ARCHIVE_KEY;

        // localStorage: legg til i archived, IKKE fjern fra saved (sikkerhetskopi)
        var saved = safeParseJSON(storageKey, []);
        var existingIndex = saved.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (existingIndex !== -1) {
            data.id = saved[existingIndex].id;
        } else {
            data.id = Date.now().toString();
        }
        var archived = safeParseJSON(archiveKey, []);
        var archivedExisting = archived.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (archivedExisting !== -1) {
            archived[archivedExisting] = data;
        } else {
            archived.unshift(data);
        }
        safeSetItem(archiveKey, JSON.stringify(archived));
        addToOrderNumberIndex(data.ordreseddelNr);

        // Update UI state
        sessionStorage.setItem('firesafe_current_sent', '1');
        lastSavedData = getFormDataSnapshot();
        document.getElementById('sent-banner').style.display = 'block';
        var headerDoneBtn = document.getElementById('header-done-btn');
        if (headerDoneBtn) headerDoneBtn.style.display = 'none';
        showNotificationModal(t('marked_as_sent'), true);
        _lastLocalSaveTs = Date.now();

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

// === External forms tab ===

function renderExternalFormsList(forms, append, hasMore) {
    var listEl = document.getElementById('external-list');
    var existingBtn = listEl.querySelector('.load-more-btn');
    if (existingBtn) existingBtn.remove();

    if (!append) {
        if (!forms || forms.length === 0) {
            listEl.innerHTML = '<div class="no-saved">' + t('no_external_forms') + '</div>';
            return;
        }
        window.loadedExternalForms = forms;
        listEl.innerHTML = forms.map(function(item, i) { return _buildSavedItemHtml(item, i); }).join('');
    } else {
        var startIndex = window.loadedExternalForms.length;
        window.loadedExternalForms = window.loadedExternalForms.concat(forms);
        var html = forms.map(function(item, i) { return _buildSavedItemHtml(item, startIndex + i); }).join('');
        listEl.insertAdjacentHTML('beforeend', html);
    }

    listEl.querySelectorAll('.saved-item').forEach(function(el, i) {
        el._formData = window.loadedExternalForms[i];
    });

    if (hasMore) {
        listEl.insertAdjacentHTML('beforeend', '<button class="load-more-btn" onclick="loadMoreExternalForms()">' + t('load_more') + '</button>');
    }
}

async function loadMoreExternalForms() {
    var btn = document.querySelector('#external-list .load-more-btn');
    if (btn) btn.textContent = '...';
    var newForms = [];
    if (_extHasMore && _extLastDoc) {
        var result = await getExternalForms(_extLastDoc);
        _extLastDoc = result.lastDoc;
        _extHasMore = result.hasMore;
        newForms = newForms.concat(result.forms);
    }
    if (_extSentHasMore && _extSentLastDoc) {
        var result2 = await getExternalSentForms(_extSentLastDoc);
        _extSentLastDoc = result2.lastDoc;
        _extSentHasMore = result2.hasMore;
        newForms = newForms.concat(result2.forms.map(function(f) { return Object.assign({}, f, { _isSent: true }); }));
    }
    newForms.sort(function(a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
    renderExternalFormsList(newForms, true, _extHasMore || _extSentHasMore);
}

async function loadExternalTab() {
    // Show cached data immediately
    const cachedForms = safeParseJSON(EXTERNAL_KEY, []);
    const cachedSent = safeParseJSON(EXTERNAL_ARCHIVE_KEY, []);
    const cached = _mergeAndDedup(
        cachedForms.map(f => ({ ...f, _isSent: false })),
        cachedSent.map(f => ({ ...f, _isSent: true }))
    );
    renderExternalFormsList(cached);

    var results = await Promise.all([getExternalForms(), getExternalSentForms()]);
    if (Date.now() - _lastLocalSaveTs < 5000) return;
    var extResult = results[0], extSentResult = results[1];
    _extLastDoc = extResult.lastDoc;
    _extSentLastDoc = extSentResult.lastDoc;
    _extHasMore = extResult.hasMore;
    _extSentHasMore = extSentResult.hasMore;
    if (currentUser) {
        safeSetItem(EXTERNAL_KEY, JSON.stringify(extResult.forms.slice(0, 50)));
        safeSetItem(EXTERNAL_ARCHIVE_KEY, JSON.stringify(extSentResult.forms.slice(0, 50)));
    }
    window.loadedExternalForms = _mergeAndDedup(
        extResult.forms.map(f => ({ ...f, _isSent: false })),
        extSentResult.forms.map(f => ({ ...f, _isSent: true }))
    );
    if (!document.body.classList.contains('saved-modal-open')) return;
    if (currentUser || window.loadedExternalForms.length > 0) {
        renderExternalFormsList(window.loadedExternalForms, false, _extHasMore || _extSentHasMore);
    }
}

function loadExternalForm(index) {
    const form = window.loadedExternalForms[index];
    if (!form) return;
    loadExternalFormDirect(form);
}

function loadExternalFormDirect(form) {
    if (!form) return;
    setFormData(form);
    isExternalForm = true;
    updateFormTypeChip();

    // Autofyll med eksterne innstillinger
    autoFillDefaults('external');
    var flags = getAutofillFlags('external');
    var now = new Date();
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

    lastSavedData = getFormDataSnapshot();
    const isSent = !!form._isSent;
    // Show sent banner but keep form editable
    document.getElementById('sent-banner').style.display = isSent ? 'block' : 'none';
    var headerDoneBtn = document.getElementById('header-done-btn');
    if (headerDoneBtn) headerDoneBtn.style.display = isSent ? 'none' : '';
    sessionStorage.setItem('firesafe_current_sent', isSent ? '1' : '');
    closeModal();
    // External form = #ekstern
    window.location.hash = 'ekstern';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('form_title');
    window.scrollTo(0, 0);
}

function deleteExternalForm(event, index) {
    if (event) event.stopPropagation();
    const form = window.loadedExternalForms[index];
    if (!form) return;
    deleteExternalFormDirect(form);
}

function deleteExternalFormDirect(form) {
    if (!form) return;
    const isSent = form._isSent;
    const confirmMsg = isSent ? t('delete_sent_confirm') : t('delete_confirm');

    showConfirmModal(confirmMsg, function() {
        const col = isSent ? 'externalArchive' : 'external';
        const lsKey = isSent ? EXTERNAL_ARCHIVE_KEY : EXTERNAL_KEY;

        // Optimistic removal: update local state + DOM immediately
        var arrIdx = window.loadedExternalForms.findIndex(function(f) { return f.id === form.id; });
        if (arrIdx !== -1) window.loadedExternalForms.splice(arrIdx, 1);
        var lsList = safeParseJSON(lsKey, []);
        var lsIdx = lsList.findIndex(function(f) { return f.id === form.id; });
        if (lsIdx !== -1) { lsList.splice(lsIdx, 1); safeSetItem(lsKey, JSON.stringify(lsList)); }
        // Remove DOM element
        document.querySelectorAll('#external-list .saved-item').forEach(function(el) {
            if (el._formData && el._formData.id === form.id) el.remove();
        });
        // Show empty message if no items left
        if (window.loadedExternalForms.length === 0) {
            document.getElementById('external-list').innerHTML = '<div class="no-saved">' + t('no_external_forms') + '</div>';
        }

        _lastLocalSaveTs = Date.now();

        // Firebase in background (serialized)
        if (currentUser && db) {
            var docId = form.id;
            _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                return db.collection('users').doc(currentUser.uid).collection(col).doc(docId).delete();
            }).catch(function(e) { console.error('Delete external error:', e); });
        }
    });
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

    // Show cached templates immediately (filter out deactivated)
    const cached = safeParseJSON(TEMPLATE_KEY, []).filter(function(t) { return t.active !== false; });
    renderTemplateList(cached);

    showView('template-modal');
    document.body.classList.add('template-modal-open');
    updateToolbarState();

    // Refresh from Firestore in background
    if (currentUser && db) {
        getTemplates().then(function(result) {
            _templateLastDoc = result.lastDoc;
            _templateHasMore = result.hasMore;
            safeSetItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
            // Only update if still on template-modal (filter out deactivated)
            if (document.body.classList.contains('template-modal-open')) {
                var activeTemplates = result.forms.filter(function(t) { return t.active !== false; });
                renderTemplateList(activeTemplates, false, _templateHasMore);
            }
        }).catch(function(e) { console.error('Refresh templates:', e); });
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
    document.getElementById('template-search').value = '';
    window.location.hash = 'skjema';
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
        // Remove DOM element
        document.querySelectorAll('#template-list .saved-item').forEach(function(el) {
            if (el._formData && el._formData.id === template.id) el.remove();
        });
        // Show empty message if no items left
        if (window.loadedTemplates.length === 0) {
            document.getElementById('template-list').innerHTML = '<div class="no-saved">' + t('no_templates') + '</div>';
        }

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
    document.getElementById('template-search').value = '';
    window.location.hash = 'skjema';
    document.getElementById('form-header-title').textContent = t('form_title');
    updateOrderDeleteStates();
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    lastSavedData = getFormDataSnapshot();
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
        var tabs = document.querySelectorAll('#settings-page-defaults .settings-tab');
        if (tabs.length) { tabs[0].classList.add('active'); tabs[1].classList.remove('active'); }
        // Show cached immediately, then background refresh
        loadDefaultsForTab('own');
        initDefaultsAutoSave();
    } else if (page === 'required') {
        // Show cached immediately
        cachedRequiredSettings = _getCachedRequiredSettings();
        renderRequiredSettingsItems('save');
        // Background refresh
        getRequiredSettings().then(function(settings) {
            if (document.body.classList.contains('settings-modal-open')) {
                cachedRequiredSettings = settings;
                renderRequiredSettingsItems('save');
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
        settingsUnits = cachedData.units.slice();
        settingsMaterials.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
        sortUnits(settingsUnits);
        renderMaterialSettingsItems();
        renderUnitSettingsItems();
        document.getElementById('settings-new-material').value = '';
        collapseUnitAddRow();
        // Background refresh
        getMaterialSettings().then(function(data) {
            if (!document.body.classList.contains('settings-modal-open')) return;
            settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
            settingsUnits = (data && data.units) ? data.units.slice() : [];
            settingsMaterials.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
            sortUnits(settingsUnits);
            renderMaterialSettingsItems();
            renderUnitSettingsItems();
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
                template: Object.assign({}, defaults.template, data.template || {})
            };
        } catch (e) {}
    }
    return getDefaultRequiredSettings();
}

// ============================================
// MATERIALER OG ENHETER INNSTILLINGER
// ============================================

let settingsMaterials = [];
let settingsUnits = [];

function normalizeMaterialData(data) {
    if (!data) return { materials: [], units: [] };
    let materials = data.materials || [];
    if (materials.length > 0 && typeof materials[0] === 'string') {
        materials = materials.map(name => ({ name: name, needsSpec: false }));
    }
    let units = data.units || [];
    if (units.length > 0 && typeof units[0] === 'string') {
        units = units.map(u => ({ singular: u, plural: u }));
    }
    return { materials, units };
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
    const data = { materials: settingsMaterials.map(m => ({ name: m.name, needsSpec: !!m.needsSpec })), units: settingsUnits.slice() };
    // localStorage + cache first (optimistic)
    safeSetItem(MATERIALS_KEY, JSON.stringify(data));
    cachedMaterialOptions = data.materials.slice();
    cachedMaterialOptions.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
    cachedUnitOptions = settingsUnits.slice();
    sortUnits(cachedUnitOptions);

    // Firebase in background
    if (currentUser && db) {
        db.collection('settings').doc('materials').set(data)
            .catch(function(e) { console.error('Save materials settings error:', e); });
    }
}

async function loadMaterialSettingsToModal() {
    const data = await getMaterialSettings();
    settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
    settingsUnits = (data && data.units) ? data.units.slice() : [];
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    sortUnits(settingsUnits);
    renderMaterialSettingsItems();
    renderUnitSettingsItems();
    document.getElementById('settings-new-material').value = '';
    collapseUnitAddRow();
}

function renderMaterialSettingsItems() {
    const container = document.getElementById('settings-material-items');
    if (settingsMaterials.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_materials') + '</div>';
        return;
    }
    container.innerHTML = settingsMaterials.map((item, idx) =>
        `<div class="settings-list-item"><span onclick="editSettingsMaterial(${idx})">${escapeHtml(item.name)}</span><button class="settings-spec-toggle${item.needsSpec ? ' active' : ''}" onclick="toggleMaterialSpec(${idx})" title="${t('settings_spec_toggle')}">Spec</button><button class="settings-delete-btn" onclick="removeSettingsMaterial(${idx})" title="${t('btn_remove')}">${deleteIcon}</button></div>`
    ).join('');
}

function renderUnitSettingsItems() {
    const container = document.getElementById('settings-unit-items');
    if (settingsUnits.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_units') + '</div>';
        return;
    }
    container.innerHTML = settingsUnits.map((item, idx) =>
        `<div class="settings-list-item"><span onclick="editSettingsUnit(${idx})">${item.singular === item.plural ? escapeHtml(item.singular) : escapeHtml(item.singular) + ' / ' + escapeHtml(item.plural)}</span><button class="settings-delete-btn" onclick="removeSettingsUnit(${idx})" title="${t('btn_remove')}">${deleteIcon}</button></div>`
    ).join('');
}

function editSettingsUnit(idx) {
    if (!isAdmin) return;
    const container = document.getElementById('settings-unit-items');
    const item = container.children[idx];
    const span = item.querySelector('span');
    if (!span) return;
    const oldSingular = settingsUnits[idx].singular;
    const oldPlural = settingsUnits[idx].plural;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex:1;gap:4px;min-width:0;';

    const inputS = document.createElement('input');
    inputS.type = 'text';
    inputS.className = 'settings-unit-input';
    inputS.value = oldSingular;
    inputS.placeholder = 'Entall';

    const inputP = document.createElement('input');
    inputP.type = 'text';
    inputP.className = 'settings-unit-input';
    inputP.value = oldPlural;
    inputP.placeholder = 'Flertall';

    wrapper.appendChild(inputS);
    wrapper.appendChild(inputP);
    span.replaceWith(wrapper);
    inputS.focus();
    inputS.select();

    let saved = false;
    function handleBlur(e) {
        if (saved) return;
        // If focus moved to the sibling input, don't save yet
        if (e.relatedTarget === inputS || e.relatedTarget === inputP) return;
        saved = true;

        // Check if a unit span was clicked (relatedTarget is null for non-focusable spans,
        // so we use mousedown capture instead)
        const pendingPlural = container._pendingEditPlural;
        delete container._pendingEditPlural;
        container.removeEventListener('mousedown', onMousedown);

        const newS = inputS.value.trim();
        const newP = inputP.value.trim();
        const changed = !(!newS && !newP) && !(newS === oldSingular && newP === oldPlural);

        if (changed) {
            if (newP && settingsUnits.some((u, i) => i !== idx && u.plural.toLowerCase() === newP.toLowerCase())) {
                showNotificationModal(t('settings_unit_exists'));
                renderUnitSettingsItems();
                if (pendingPlural) { const ni = settingsUnits.findIndex(u => u.plural === pendingPlural); if (ni >= 0) editSettingsUnit(ni); }
                return;
            }
            settingsUnits[idx].singular = newS || oldSingular;
            settingsUnits[idx].plural = newP || oldPlural;
            sortUnits(settingsUnits);
        }

        renderUnitSettingsItems();
        if (pendingPlural) {
            const ni = settingsUnits.findIndex(u => u.plural === pendingPlural);
            if (ni >= 0) editSettingsUnit(ni);
        }
        if (changed) saveMaterialSettings();
    }

    // Capture mousedown on other unit spans before blur fires
    function onMousedown(e) {
        const clickedSpan = e.target.closest('.settings-list-item span');
        if (clickedSpan) {
            const clickedItem = clickedSpan.parentElement;
            const clickIdx = Array.from(container.children).indexOf(clickedItem);
            if (clickIdx >= 0) container._pendingEditPlural = settingsUnits[clickIdx].plural;
        }
    }
    container.addEventListener('mousedown', onMousedown);

    inputS.addEventListener('blur', handleBlur);
    inputP.addEventListener('blur', handleBlur);
    function handleKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (e.key === 'Escape') { saved = true; container.removeEventListener('mousedown', onMousedown); renderUnitSettingsItems(); }
    }
    inputS.addEventListener('keydown', handleKey);
    inputP.addEventListener('keydown', handleKey);
}

function toggleSettingsSection(section) {
    const body = document.getElementById('settings-body-' + section);
    const arrow = document.getElementById('settings-arrow-' + section);
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

async function addSettingsMaterial() {
    if (!isAdmin) return;
    const input = document.getElementById('settings-new-material');
    const val = input.value.trim();
    if (!val) return;
    if (settingsMaterials.some(m => m.name.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_material_exists'));
        return;
    }
    settingsMaterials.push({ name: val, needsSpec: false });
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    input.value = '';
    renderMaterialSettingsItems();
    await saveMaterialSettings();
    showNotificationModal(t('settings_material_added'), true);
}

async function addSettingsUnit() {
    if (!isAdmin) return;
    const singularInput = document.getElementById('settings-new-unit-singular');
    const pluralInput = document.getElementById('settings-new-unit-plural');
    if (!singularInput || !pluralInput) return;
    const singular = singularInput.value.trim();
    const plural = pluralInput.value.trim();
    if (!singular || !plural) return;
    if (settingsUnits.some(u => u.plural.toLowerCase() === plural.toLowerCase())) {
        showNotificationModal(t('settings_unit_exists'));
        return;
    }
    settingsUnits.push({ singular, plural });
    sortUnits(settingsUnits);
    collapseUnitAddRow();
    renderUnitSettingsItems();
    await saveMaterialSettings();
    showNotificationModal(t('settings_unit_added'), true);
}

function expandUnitAddRow() {
    const singleInput = document.getElementById('settings-new-unit');
    if (!singleInput) return;
    const addRow = document.getElementById('settings-unit-add-row');
    const btn = addRow.querySelector('.settings-add-btn');

    const inputS = document.createElement('input');
    inputS.type = 'text';
    inputS.className = 'settings-unit-input';
    inputS.id = 'settings-new-unit-singular';
    inputS.placeholder = 'Entall';
    inputS.autocapitalize = 'sentences';

    const inputP = document.createElement('input');
    inputP.type = 'text';
    inputP.className = 'settings-unit-input';
    inputP.id = 'settings-new-unit-plural';
    inputP.placeholder = 'Flertall';
    inputP.autocapitalize = 'sentences';

    singleInput.replaceWith(inputS);
    btn.before(inputP);
    inputS.focus();

    async function maybeCollapse() {
        await new Promise(r => setTimeout(r, 10));
        if (document.activeElement === inputS || document.activeElement === inputP) return;
        if (inputS.value.trim() || inputP.value.trim()) return;
        collapseUnitAddRow();
    }
    inputS.addEventListener('blur', maybeCollapse);
    inputP.addEventListener('blur', maybeCollapse);
}

function collapseUnitAddRow() {
    const inputS = document.getElementById('settings-new-unit-singular');
    const inputP = document.getElementById('settings-new-unit-plural');
    if (!inputS && !inputP) return;
    const singleInput = document.createElement('input');
    singleInput.type = 'text';
    singleInput.id = 'settings-new-unit';
    singleInput.placeholder = 'Ny enhet';
    singleInput.autocapitalize = 'sentences';
    singleInput.setAttribute('onfocus', 'expandUnitAddRow()');
    if (inputP) inputP.remove();
    if (inputS) inputS.replaceWith(singleInput);
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

function removeSettingsUnit(idx) {
    if (!isAdmin) return;
    const item = settingsUnits[idx];
    showConfirmModal(t('settings_material_remove', item.plural), async function() {
        settingsUnits.splice(idx, 1);
        renderUnitSettingsItems();
        await saveMaterialSettings();
    });
}

function editSettingsMaterial(idx) {
    if (!isAdmin) return;
    const container = document.getElementById('settings-material-items');
    const item = container.children[idx];
    const span = item.querySelector('span');
    if (!span) return;
    const oldVal = settingsMaterials[idx].name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = oldVal;
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
            newSpan.textContent = oldVal;
            newSpan.setAttribute('onclick', 'editSettingsMaterial(' + idx + ')');
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

async function toggleMaterialSpec(idx) {
    if (!isAdmin) return;
    settingsMaterials[idx].needsSpec = !settingsMaterials[idx].needsSpec;
    renderMaterialSettingsItems();
    await saveMaterialSettings();
}


// ============================================
// DROPDOWN FOR MATERIALE OG ENHET
// ============================================

// Cache for dropdown options
let cachedMaterialOptions = null;
let cachedUnitOptions = null;

async function getDropdownOptions() {
    // Show cached immediately so picker is never empty
    if (!cachedMaterialOptions) {
        var stored = localStorage.getItem(MATERIALS_KEY);
        if (stored) {
            var cached = normalizeMaterialData(JSON.parse(stored));
            cachedMaterialOptions = (cached && cached.materials) ? cached.materials : [];
            cachedUnitOptions = (cached && cached.units) ? cached.units : [];
            cachedMaterialOptions.sort(function(a, b) { return a.name.localeCompare(b.name, 'no'); });
            sortUnits(cachedUnitOptions);
        }
    }
    // Refresh from Firebase
    const data = await getMaterialSettings();
    cachedMaterialOptions = (data && data.materials) ? data.materials : [];
    cachedUnitOptions = (data && data.units) ? data.units : [];
    cachedMaterialOptions.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    sortUnits(cachedUnitOptions);
    // Cache to localStorage for offline use
    safeSetItem(MATERIALS_KEY, JSON.stringify({ materials: cachedMaterialOptions, units: cachedUnitOptions }));
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
                    template: { ...defaults.template, ...(data.template || {}) }
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
                template: { ...defaults.template, ...(data.template || {}) }
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
}

// ============================================
// STANDARDVERDIER (AUTOFYLL)
// ============================================

const DEFAULT_FIELDS = ['montor', 'avdeling', 'sted'];

var _defaultsTab = 'own';

async function getDefaultSettings(tab) {
    var key = tab === 'external' ? DEFAULTS_EXTERNAL_KEY : DEFAULTS_KEY;
    var fbDoc = tab === 'external' ? 'defaults_external' : 'defaults';
    if (currentUser && db) {
        try {
            var doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc(fbDoc).get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.error('Defaults error:', e);
        }
    }
    var stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : {};
}

async function syncDefaultsToLocal() {
    if (!db || !currentUser) return;
    try {
        var results = await Promise.all([
            db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults').get(),
            db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults_external').get()
        ]);
        if (results[0].exists) safeSetItem(DEFAULTS_KEY, JSON.stringify(results[0].data()));
        if (results[1].exists) safeSetItem(DEFAULTS_EXTERNAL_KEY, JSON.stringify(results[1].data()));
    } catch (e) { /* localStorage-cache brukes som fallback */ }
}

function saveDefaultSettings() {
    var defaults = {};
    DEFAULT_FIELDS.forEach(field => {
        var val = document.getElementById('default-' + field).value.trim();
        if (val) defaults[field] = val;
    });
    // Behold autofill-toggles fra eksisterende data
    var key = _defaultsTab === 'external' ? DEFAULTS_EXTERNAL_KEY : DEFAULTS_KEY;
    var fbDoc = _defaultsTab === 'external' ? 'defaults_external' : 'defaults';
    var existing = safeParseJSON(key, {});
    ['autofill_uke', 'autofill_dato', 'autofill_sted'].forEach(function(k) {
        if (existing[k] !== undefined) defaults[k] = existing[k];
    });
    // localStorage first (optimistic)
    safeSetItem(key, JSON.stringify(defaults));

    // Firebase in background
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
}

function switchDefaultsTab(tab) {
    _defaultsTab = tab;
    var tabs = document.querySelectorAll('#settings-page-defaults .settings-tab');
    tabs.forEach(function(t) { t.classList.remove('active'); });
    tabs[tab === 'own' ? 0 : 1].classList.add('active');
    loadDefaultsForTab(tab);
}

function _applyDefaultsToUI(defaults) {
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
}

function loadDefaultsForTab(tab) {
    // Show cached immediately
    var key = tab === 'external' ? DEFAULTS_EXTERNAL_KEY : DEFAULTS_KEY;
    var stored = localStorage.getItem(key);
    _applyDefaultsToUI(stored ? JSON.parse(stored) : {});
    // Background refresh
    getDefaultSettings(tab).then(function(defaults) {
        if (document.body.classList.contains('settings-modal-open'))
            _applyDefaultsToUI(defaults);
    });
}

function autoFillDefaults(type) {
    var key = type === 'external' ? DEFAULTS_EXTERNAL_KEY : DEFAULTS_KEY;
    var stored = localStorage.getItem(key);
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
    var key = type === 'external' ? DEFAULTS_EXTERNAL_KEY : DEFAULTS_KEY;
    var stored = localStorage.getItem(key);
    var defaults = stored ? JSON.parse(stored) : {};
    return {
        uke: defaults.autofill_uke !== false,
        dato: defaults.autofill_dato !== false,
        sted: defaults.autofill_sted !== false
    };
}

function saveAutofillToggle(key, value) {
    var storageKey = _defaultsTab === 'external' ? DEFAULTS_EXTERNAL_KEY : DEFAULTS_KEY;
    var fbDoc = _defaultsTab === 'external' ? 'defaults_external' : 'defaults';
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
    var tabs = document.querySelectorAll('#form-type-tabs .form-type-tab');
    if (!tabs.length) return;
    tabs[0].classList.toggle('active', !isExternalForm);
    tabs[1].classList.toggle('active', isExternalForm);
    var badge = document.getElementById('external-badge');
    if (badge) badge.style.display = isExternalForm ? '' : 'none';
}

function switchFormType(type) {
    var newExternal = type === 'external';
    if (newExternal === isExternalForm) return;
    isExternalForm = newExternal;
    updateFormTypeChip();
    window.location.hash = isExternalForm ? 'ekstern' : 'skjema';
    document.getElementById('form-header-title').textContent =
        t('form_title');

    // Ordrenummer: eksterne bruker ikke egne nummerområder
    if (isExternalForm) {
        document.getElementById('ordreseddel-nr').value = '';
        document.getElementById('mobile-ordreseddel-nr').value = '';
    } else {
        autoFillOrderNumber();
    }

    // Tøm autofyll-felt først, så applyer riktig profil
    DEFAULT_FIELDS.forEach(function(field) {
        var el = document.getElementById(field);
        var mobileEl = document.getElementById('mobile-' + field);
        if (el) el.value = '';
        if (mobileEl) mobileEl.value = '';
    });
    document.getElementById('dato').value = '';
    document.getElementById('mobile-dato').value = '';
    document.getElementById('signering-dato').value = '';
    document.getElementById('mobile-signering-dato').value = '';

    // Applyer autofyll fra riktig profil
    var afType = isExternalForm ? 'external' : undefined;
    autoFillDefaults(afType);
    var flags = getAutofillFlags(afType);
    var now = new Date();
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
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    lastSavedData = getFormDataSnapshot();
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
        && !document.getElementById('template-modal').classList.contains('active');
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
    var headerDoneBtn = document.getElementById('header-done-btn');
    if (headerDoneBtn) headerDoneBtn.style.display = '';
    lastSavedData = null;
    isExternalForm = false;
    updateFormTypeChip();
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

// Event delegation for external-list items
document.getElementById('external-list').addEventListener('click', function(e) {
    const savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    // Get form data directly from the element
    const formData = savedItem._formData;
    if (!formData) return;

    // Check if click was on a button
    const btn = e.target.closest('button');
    if (btn) {
        if (btn.classList.contains('disabled')) return;
        e.stopPropagation();
        if (btn.classList.contains('delete')) {
            deleteExternalFormDirect(formData);
        } else if (btn.classList.contains('copy')) {
            duplicateFormDirect(formData);
        }
        return;
    }

    // Click on item row - load the form
    loadExternalFormDirect(formData);
});

// Event delegation for template-list items
document.getElementById('template-list').addEventListener('click', function(e) {
    const savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    // Get template data directly from the element
    const templateData = savedItem._formData;
    if (!templateData) return;

    // Check if click was on delete button
    const btn = e.target.closest('button');
    if (btn && btn.classList.contains('delete')) {
        e.stopPropagation();
        deleteTemplateDirect(templateData);
        return;
    }

    // Click on item row - load the template
    loadTemplateDirect(templateData);
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

document.addEventListener('DOMContentLoaded', function() {
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
    if (hash === 'skjema' || hash === 'ekstern') {
        if (hash === 'ekstern') isExternalForm = true;
        document.getElementById('form-header-title').textContent = t('form_title');
        updateFormTypeChip();
        const wasSent = sessionStorage.getItem('firesafe_current_sent') === '1';
        if (wasSent) {
            document.getElementById('sent-banner').style.display = 'block';
            var headerDoneBtn = document.getElementById('header-done-btn');
            if (headerDoneBtn) headerDoneBtn.style.display = 'none';
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
        renderSavedFormsList(cachedSaved.map(f => ({ ...f, _isSent: false })).concat(cachedSent.map(f => ({ ...f, _isSent: true }))).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')));
        updateToolbarState();
    } else if (hash === 'settings' || hash.indexOf('settings/') === 0) {
        var subPage = hash.split('/')[1] || sessionStorage.getItem('firesafe_settings_page');
        if (subPage) {
            showSettingsPage(subPage);
        } else {
            showSettingsMenu();
        }
        updateToolbarState();
    } else if (!hash || hash === '') {
        // Home page - render cached templates (filter out deactivated)
        var cached = safeParseJSON(TEMPLATE_KEY, []).filter(function(t) { return t.active !== false; });
        renderTemplateList(cached);
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
        showSavedForms();
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
        updateFormTypeChip();
        updateToolbarState();
    } else if (hash === 'ekstern') {
        showView('view-form');
        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
        document.getElementById('form-header-title').textContent = t('form_title');
        updateFormTypeChip();
        updateToolbarState();
    } else {
        // No hash = home = template modal
        showTemplateModal();
    }
});


