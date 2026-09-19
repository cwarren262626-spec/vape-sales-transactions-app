// ---------------------------------------------------------------
// KuslagVape — Sales Transactions web app
// Vanilla JS + Supabase JS v2. See config.js for credentials.
//
// User management (add user / change password) is NOT done with
// the anon key — Supabase has no safe way to create users or set
// passwords for other accounts from client-side code. Those calls
// go through the "admin-users" Edge Function (see
// supabase/functions/admin-users), which uses the service_role key
// on the server and re-checks is_admin() before doing anything.
// ---------------------------------------------------------------

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  isAdmin: false,
  activeTab: "new",
  products: [],
  selectedProduct: null,
  transactions: [],
  txPage: 1,
  users: [],
};

const TX_PAGE_SIZE = 10;

// ---------- helpers ----------

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function showToast(message, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function displayName(product) {
  return [product.product_name, product.flavor].filter(Boolean).join(" • ");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

const ICONS = {
  sale: `<svg viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>`,
  box: `<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h13a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><path d="M16.5 12h2"/></svg>`,
  list: `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`,
  bars: `<svg viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>`,
  alertTriangle: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  alertCircle: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
};

function initialsFor(email) {
  if (!email) return "–";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

// ---------- auth ----------

async function init() {
  const { data } = await supabaseClient.auth.getSession();
  state.session = data.session;
  applyAuthState();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    applyAuthState();
  });

  $("#login-form").addEventListener("submit", handleLogin);
  $("#sign-out-btn").addEventListener("click", () => supabaseClient.auth.signOut());
  $("#sidebar-signout-btn").addEventListener("click", () => supabaseClient.auth.signOut());

  $all("nav.bottom-tabs button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("#tx-form").addEventListener("submit", handleSaveTransaction);
  $("#product-search").addEventListener("input", handleProductSearch);
  $("#product-search").addEventListener("focus", handleProductSearch);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".searchable")) {
      $("#product-results").classList.add("hidden");
    }
  });

  $("#add-product-fab").addEventListener("click", () => openProductDialog(null));
  $("#add-user-fab").addEventListener("click", () => openUserDialog());
  $("#report-btn").addEventListener("click", openReportDialog);
  $("#brand-filter").addEventListener("change", renderProducts);

  // Any filter change puts you back on page 1 — otherwise you can end
  // up stranded on, say, page 4 of a result set that's now one page.
  $("#user-filter").addEventListener("change", () => { state.txPage = 1; renderTransactions(); });
  $("#date-from").addEventListener("change", () => { state.txPage = 1; renderTransactions(); });
  $("#date-to").addEventListener("change", () => { state.txPage = 1; renderTransactions(); });

  $all(".filter-chips .chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyDateRange(btn.dataset.range));
  });
}

// Quick date presets — they just fill in the two date inputs, so the
// inputs stay the single source of truth for the filter.
function applyDateRange(range) {
  const from = $("#date-from");
  const to = $("#date-to");
  const iso = (d) => {
    const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return x.toISOString().slice(0, 10);
  };
  const today = new Date();

  if (range === "all") {
    from.value = "";
    to.value = "";
  } else if (range === "today") {
    from.value = iso(today);
    to.value = iso(today);
  } else if (range === "month") {
    from.value = iso(new Date(today.getFullYear(), today.getMonth(), 1));
    to.value = iso(today);
  } else {
    const days = parseInt(range, 10);
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    from.value = iso(start);
    to.value = iso(today);
  }

  state.txPage = 1;
  renderTransactions();
}

function applyAuthState() {
  const loggedIn = !!state.session;
  $("#login-view").classList.toggle("hidden", loggedIn);
  $("#app-view").classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    const email = state.session.user.email || "";
    state.isAdmin = ADMIN_EMAILS.includes(email);
    $("#current-email").textContent = email;
    $("#user-avatar").textContent = initialsFor(email);
    $("#role-chip").classList.toggle("hidden", !state.isAdmin);
    $("#users-nav").classList.toggle("hidden", !state.isAdmin);
    $("#dashboard-nav").classList.toggle("hidden", !state.isAdmin);
    switchTab("new");
    loadProducts();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const errorEl = $("#login-error");
  const btn = $("#login-submit");
  errorEl.textContent = "";

  if (!email || !password) {
    errorEl.textContent = "Please fill in both fields";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in…";
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = "Sign in";

  if (error) {
    errorEl.textContent = "Login failed: " + error.message;
  }
}

// ---------- tabs ----------

function switchTab(tab) {
  if ((tab === "users" || tab === "dashboard") && !state.isAdmin) tab = "new";
  state.activeTab = tab;
  $all("nav.bottom-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $all("main.screen > section").forEach((s) => s.classList.add("hidden"));
  $("#screen-" + tab).classList.remove("hidden");

  // Single source of truth for both floating "+" buttons: each is only
  // ever visible for an admin on its own tab, and hidden on every other
  // tab (including right away, before that tab's data has loaded).
  $("#add-product-fab").classList.toggle("hidden", !(state.isAdmin && tab === "products"));
  $("#add-user-fab").classList.toggle("hidden", !(state.isAdmin && tab === "users"));

  if (tab === "transactions") loadTransactions();
  if (tab === "products") loadProducts(true);
  if (tab === "new") loadProducts();
  if (tab === "users") loadUsers();
  if (tab === "dashboard") loadDashboard();
}

// ---------- New Transaction ----------

async function loadProducts(forProductsTab = false) {
  const { data, error } = await supabaseClient
    .from("ProductList")
    .select("*")
    .order("product_name", { ascending: true });

  if (error) {
    showToast("Failed to load products: " + error.message, true);
    return;
  }
  state.products = data || [];

  if (!forProductsTab) renderTxProductBox();
  renderProducts();
}

function renderTxProductBox() {
  const inStock = state.products.filter((p) => p.stocks_count > 0);
  const box = $("#tx-product-box");
  if (inStock.length === 0) {
    box.innerHTML = `<p class="muted">No in-stock products available. Add stock in the Products tab first.</p>`;
    $("#tx-form-fields").classList.add("hidden");
    return;
  }
  $("#tx-form-fields").classList.remove("hidden");
  box.innerHTML = "";
}

function handleProductSearch() {
  const query = $("#product-search").value.trim().toLowerCase();
  const inStock = state.products.filter((p) => p.stocks_count > 0);
  const matches = query
    ? inStock.filter((p) => displayName(p).toLowerCase().includes(query))
    : inStock;

  const resultsEl = $("#product-results");
  if (matches.length === 0) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
    return;
  }
  resultsEl.innerHTML = matches.map((p) => `
    <div class="opt" data-id="${p.id}">
      ${escapeHtml(displayName(p))}
      <div class="stock">Stock: ${p.stocks_count}</div>
    </div>
  `).join("");
  resultsEl.classList.remove("hidden");

  $all(".opt", resultsEl).forEach((el) => {
    el.addEventListener("click", () => {
      const product = state.products.find((p) => String(p.id) === el.dataset.id);
      selectProduct(product);
      resultsEl.classList.add("hidden");
    });
  });
}

function selectProduct(product) {
  state.selectedProduct = product;
  $("#product-search").value = displayName(product);
  $("#tx-stock-line").textContent = `Available stock: ${product.stocks_count}`;
  $("#tx-stock-line").classList.remove("hidden");
  updateSaveEnabled();
}

function updateSaveEnabled() {
  const qty = $("#tx-quantity").value.trim();
  const amount = $("#tx-amount").value.trim();
  $("#tx-save-btn").disabled = !(state.selectedProduct && qty && amount);
}

document.addEventListener("input", (e) => {
  if (e.target.id === "tx-quantity" || e.target.id === "tx-amount") updateSaveEnabled();
});

async function handleSaveTransaction(e) {
  e.preventDefault();
  const errorEl = $("#tx-error");
  errorEl.textContent = "";

  const product = state.selectedProduct;
  const qty = parseInt($("#tx-quantity").value, 10);
  const amount = parseFloat($("#tx-amount").value);
  const remarks = $("#tx-remarks").value.trim();

  if (!product) { errorEl.textContent = "Select a product"; return; }
  if (!qty || qty <= 0) { errorEl.textContent = "Enter a valid quantity"; return; }
  if (qty > product.stocks_count) { errorEl.textContent = `Only ${product.stocks_count} in stock`; return; }
  if (!amount || isNaN(amount)) { errorEl.textContent = "Enter a valid amount"; return; }

  const btn = $("#tx-save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  // Recording the sale and decreasing stock happens as one atomic
  // database call (see record_sale() in schema.sql) — this is what
  // prevents two simultaneous sales from clobbering each other's
  // stock update.
  const { error: saleError } = await supabaseClient.rpc("record_sale", {
    p_product_id: product.id,
    p_qty: qty,
    p_amount: amount,
    p_remarks: remarks || null,
  });

  if (saleError) {
    errorEl.textContent = "Save failed: " + saleError.message;
    btn.disabled = false;
    btn.textContent = "Save";
    return;
  }

  showToast("Transaction saved!");

  // reset form
  state.selectedProduct = null;
  $("#product-search").value = "";
  $("#tx-quantity").value = "";
  $("#tx-amount").value = "";
  $("#tx-remarks").value = "";
  $("#tx-stock-line").classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Save";

  loadProducts();
}

// ---------- Transactions list ----------

async function loadTransactions() {
  const listEl = $("#tx-list");
  listEl.innerHTML = `<p class="muted">Loading…</p>`;

  const { data, error } = await supabaseClient
    .from("SalesTransactions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="error-text">Failed to load: ${escapeHtml(error.message)}</p>`;
    return;
  }

  state.transactions = data || [];
  state.txPage = 1;
  renderTransactions();
}

function renderTransactions() {
  const data = state.transactions;
  const listEl = $("#tx-list");
  const userFilter = $("#user-filter");

  // populate the salesperson filter with whoever has recorded a sale
  const people = [...new Set(data.map((t) => t.SalesPerson).filter(Boolean))].sort();
  const currentValue = userFilter.value;
  userFilter.innerHTML = `<option value="">All users</option>` +
    people.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  if (people.includes(currentValue)) userFilter.value = currentValue;

  const selectedPerson = userFilter.value;
  const fromValue = $("#date-from").value;
  const toValue = $("#date-to").value;

  // Date bounds are inclusive on both ends: "to" covers the whole of
  // that day, not just midnight.
  const fromTime = fromValue ? new Date(fromValue + "T00:00:00").getTime() : null;
  const toTime = toValue ? new Date(toValue + "T23:59:59.999").getTime() : null;

  const filtered = data.filter((t) => {
    if (selectedPerson && t.SalesPerson !== selectedPerson) return false;
    if (fromTime === null && toTime === null) return true;
    const when = new Date(t.created_at).getTime();
    if (fromTime !== null && when < fromTime) return false;
    if (toTime !== null && when > toTime) return false;
    return true;
  });

  // Mark whichever preset chip matches the current dates, if any.
  const activeRange = currentRangeKey(fromValue, toValue);
  $all(".filter-chips .chip-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.range === activeRange);
  });

  const filteredTotal = filtered.reduce((s, t) => s + Number(t.amount || 0), 0);

  // Clamp the page in case the filter shrank the result set under us.
  const pageCount = Math.max(1, Math.ceil(filtered.length / TX_PAGE_SIZE));
  if (state.txPage > pageCount) state.txPage = pageCount;
  if (state.txPage < 1) state.txPage = 1;

  const startIndex = (state.txPage - 1) * TX_PAGE_SIZE;
  const pageRows = filtered.slice(startIndex, startIndex + TX_PAGE_SIZE);

  $("#tx-count").innerHTML = data.length === 0
    ? ""
    : `Showing ${filtered.length === 0 ? 0 : startIndex + 1}–${startIndex + pageRows.length} of ${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`
      + (filtered.length !== data.length ? ` (filtered from ${data.length})` : "")
      + ` · <strong>₱${filteredTotal.toFixed(2)}</strong>`;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><p class="muted">${data.length === 0 ? "No transactions yet." : "No transactions match these filters."}</p></div>`;
    $("#tx-pagination").innerHTML = "";
    return;
  }

  listEl.innerHTML = `
    <table class="tx-table">
      <thead>
        <tr>
          <th class="tx-col-num">#</th>
          <th class="tx-col-icon"></th>
          <th>Product</th>
          <th>Qty</th>
          <th>Amount</th>
          <th>Salesperson</th>
          <th>Date</th>
          ${state.isAdmin ? `<th class="tx-col-actions"></th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${pageRows.map((tx, i) => `
          <tr data-id="${tx.id}">
            <td class="tx-col-num" data-label="#"><span class="row-num">${startIndex + i + 1}</span></td>
            <td class="tx-col-icon"><div class="row-icon ri-sale">${ICONS.sale}</div></td>
            <td data-label="Product">
              <div class="tx-product-name">${escapeHtml(tx.ProductName)}</div>
              ${tx.remarks ? `<div class="tx-remarks">${escapeHtml(tx.remarks)}</div>` : ""}
            </td>
            <td data-label="Qty">${tx.quntity}</td>
            <td data-label="Amount"><span class="amount">₱${Number(tx.amount).toFixed(2)}</span></td>
            <td data-label="Salesperson"><span class="tag-person">${escapeHtml(tx.SalesPerson)}</span></td>
            <td data-label="Date">${formatDate(tx.created_at)}</td>
            ${state.isAdmin ? `
              <td class="tx-col-actions">
                <div class="row-actions">
                  <button class="btn btn-ghost btn-sm edit-tx">Edit</button>
                  <button class="btn btn-ghost btn-sm delete-tx">Delete</button>
                </div>
              </td>` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  renderPagination(pageCount);

  if (state.isAdmin) {
    $all(".edit-tx", listEl).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.closest("tr").dataset.id;
        const tx = data.find((t) => String(t.id) === id);
        openTransactionEditDialog(tx);
      });
    });
    $all(".delete-tx", listEl).forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const row = e.target.closest("tr");
        if (!confirm("Delete this transaction?")) return;
        const { error: delError } = await supabaseClient
          .from("SalesTransactions")
          .delete()
          .eq("id", row.dataset.id);
        if (delError) showToast("Delete failed: " + delError.message, true);
        else { showToast("Transaction deleted"); loadTransactions(); }
      });
    });
  }
}

// Which preset chip (if any) matches the dates currently in the two
// inputs, so the right chip can be highlighted after a manual edit too.
function currentRangeKey(fromValue, toValue) {
  const iso = (d) => {
    const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return x.toISOString().slice(0, 10);
  };
  const today = new Date();
  if (!fromValue && !toValue) return "all";
  if (toValue !== iso(today)) return null;
  if (fromValue === iso(today)) return "today";
  if (fromValue === iso(new Date(today.getFullYear(), today.getMonth(), 1))) return "month";
  for (const days of [7, 30]) {
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    if (fromValue === iso(start)) return String(days);
  }
  return null;
}

// Page numbers with an ellipsis once there are more than ~7 pages, so
// the control doesn't run off the side on a long history.
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((p) => pages.add(p));

  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

function renderPagination(pageCount) {
  const el = $("#tx-pagination");
  if (pageCount <= 1) { el.innerHTML = ""; return; }

  const current = state.txPage;
  el.innerHTML = `
    <div class="pager">
      <button class="pager-btn" data-page="${current - 1}" ${current === 1 ? "disabled" : ""} aria-label="Previous page">
        <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="pager-pages">
        ${pageNumbers(current, pageCount).map((p) =>
          p === "…"
            ? `<span class="pager-gap">…</span>`
            : `<button class="pager-btn pager-num${p === current ? " active" : ""}" data-page="${p}" ${p === current ? 'aria-current="page"' : ""}>${p}</button>`
        ).join("")}
      </div>
      <button class="pager-btn" data-page="${current + 1}" ${current === pageCount ? "disabled" : ""} aria-label="Next page">
        <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="pager-info">Page ${current} of ${pageCount}</span>
    </div>
  `;

  $all(".pager-btn[data-page]", el).forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.dataset.page, 10);
      if (!page || page === state.txPage || page < 1 || page > pageCount) return;
      state.txPage = page;
      renderTransactions();
      // Jump back to the top of the list rather than leaving the user
      // mid-scroll on a freshly swapped-out page of rows.
      $("#tx-list").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function openTransactionEditDialog(tx) {
  const html = `
    <div class="modal">
      <h3>Edit transaction</h3>
      <div class="field"><label>Product name</label>
        <input type="text" id="txd-product" value="${escapeHtml(tx.ProductName)}" />
      </div>
      <div class="field"><label>Quantity</label>
        <input type="number" id="txd-qty" min="1" value="${tx.quntity}" />
      </div>
      <div class="field"><label>Amount (₱)</label>
        <input type="number" id="txd-amount" min="0" step="0.01" value="${tx.amount}" />
      </div>
      <div class="field"><label>Salesperson</label>
        <input type="text" id="txd-salesperson" value="${escapeHtml(tx.SalesPerson)}" />
      </div>
      <div class="field"><label>Remarks (optional)</label>
        <textarea id="txd-remarks" rows="2">${escapeHtml(tx.remarks || "")}</textarea>
      </div>
      <p class="error-text hidden" id="txd-error"></p>
      <div class="row-actions" style="margin-top:6px;">
        <button class="btn btn-ghost btn-sm" id="txd-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="txd-save">Save</button>
      </div>
    </div>
  `;
  const backdrop = openModal(html);

  $("#txd-cancel", backdrop).addEventListener("click", () => closeModal(backdrop));
  $("#txd-save", backdrop).addEventListener("click", async () => {
    const productName = $("#txd-product", backdrop).value.trim();
    const qty = parseInt($("#txd-qty", backdrop).value, 10);
    const amount = parseFloat($("#txd-amount", backdrop).value);
    const salesperson = $("#txd-salesperson", backdrop).value.trim();
    const remarks = $("#txd-remarks", backdrop).value.trim();
    const errorEl = $("#txd-error", backdrop);

    if (!productName) { errorEl.textContent = "Product name is required"; errorEl.classList.remove("hidden"); return; }
    if (!qty || qty <= 0) { errorEl.textContent = "Enter a valid quantity"; errorEl.classList.remove("hidden"); return; }
    if (isNaN(amount) || amount < 0) { errorEl.textContent = "Enter a valid amount"; errorEl.classList.remove("hidden"); return; }
    if (!salesperson) { errorEl.textContent = "Salesperson is required"; errorEl.classList.remove("hidden"); return; }

    const { error } = await supabaseClient
      .from("SalesTransactions")
      .update({
        ProductName: productName,
        quntity: qty,
        amount: amount,
        SalesPerson: salesperson,
        remarks: remarks || null,
      })
      .eq("id", tx.id);

    if (error) {
      errorEl.textContent = "Save failed: " + error.message;
      errorEl.classList.remove("hidden");
      return;
    }
    showToast("Transaction updated");
    closeModal(backdrop);
    loadTransactions();
  });
}

// ---------- Products ----------

function renderProducts() {
  const brandSelect = $("#brand-filter");
  const brands = [...new Set(state.products.map((p) => p.brand).filter(Boolean))].sort();
  const currentBrand = brandSelect.value;
  brandSelect.innerHTML = `<option value="">All brands</option>` +
    brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  if (brands.includes(currentBrand)) brandSelect.value = currentBrand;
  $("#brand-filter-wrap").classList.toggle("hidden", brands.length === 0);

  const selectedBrand = brandSelect.value;
  const filtered = selectedBrand ? state.products.filter((p) => p.brand === selectedBrand) : state.products;
  const totalStock = filtered.reduce((sum, p) => sum + (p.stocks_count || 0), 0);

  $("#product-total-stock").textContent = `Total stock: ${totalStock}`;
  $("#product-count").textContent = `Showing ${filtered.length} of ${state.products.length} products`;
  $("#report-btn").classList.toggle("hidden", state.products.length === 0);

  const listEl = $("#product-list");
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><p class="muted">${state.products.length === 0 ? "No products yet." : "No products match this brand."}</p></div>`;
    return;
  }

  listEl.innerHTML = filtered.map((p) => {
    const subtitle = [p.brand, p.flavor].filter(Boolean).join(" · ");
    const inStock = p.stocks_count > 0;
    const stockClass = inStock ? "stock-ok" : "stock-out";
    return `
      <div class="product-row" data-id="${p.id}">
        <div class="row-icon ri-box${inStock ? "" : " ri-out"}">${ICONS.box}</div>
        <div class="row-body">
          <div class="name">${escapeHtml(p.product_name)}</div>
          ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ""}
          <div class="stock-line ${stockClass}">Stock: ${p.stocks_count}</div>
          ${state.isAdmin ? `
            <div class="row-actions">
              <button class="btn btn-ghost btn-sm edit-product">Edit</button>
              <button class="btn btn-ghost btn-sm delete-product">Delete</button>
            </div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  if (state.isAdmin) {
    $all(".edit-product", listEl).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.closest(".product-row").dataset.id;
        const product = state.products.find((p) => String(p.id) === id);
        openProductDialog(product);
      });
    });
    $all(".delete-product", listEl).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.closest(".product-row").dataset.id;
        const product = state.products.find((p) => String(p.id) === id);
        openDeleteDialog(product);
      });
    });
  }
}

function openProductDialog(existing) {
  const isNew = !existing;
  const html = `
    <div class="modal">
      <h3>${isNew ? "Add product" : "Edit product"}</h3>
      <div class="field"><label>Product name</label>
        <input type="text" id="pd-name" value="${existing ? escapeHtml(existing.product_name) : ""}" />
      </div>
      <div class="field"><label>Brand</label>
        <input type="text" id="pd-brand" value="${existing ? escapeHtml(existing.brand || "") : ""}" />
      </div>
      <div class="field"><label>Flavor</label>
        <input type="text" id="pd-flavor" value="${existing ? escapeHtml(existing.flavor || "") : ""}" />
      </div>
      <div class="field"><label>Stock count</label>
        <input type="number" id="pd-stock" min="0" value="${existing ? existing.stocks_count : 0}" />
      </div>
      <p class="error-text hidden" id="pd-error"></p>
      <div class="row-actions" style="margin-top:6px;">
        <button class="btn btn-ghost btn-sm" id="pd-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="pd-save">Save</button>
      </div>
    </div>
  `;
  const backdrop = openModal(html);

  $("#pd-cancel", backdrop).addEventListener("click", () => closeModal(backdrop));
  $("#pd-save", backdrop).addEventListener("click", async () => {
    const name = $("#pd-name", backdrop).value.trim();
    const brand = $("#pd-brand", backdrop).value.trim();
    const flavor = $("#pd-flavor", backdrop).value.trim();
    const stock = parseInt($("#pd-stock", backdrop).value, 10) || 0;
    const errorEl = $("#pd-error", backdrop);

    if (!name) { errorEl.textContent = "Product name is required"; errorEl.classList.remove("hidden"); return; }
    if (stock > 32767) { errorEl.textContent = "Stock count is too large"; errorEl.classList.remove("hidden"); return; }

    const payload = {
      product_name: name,
      brand: brand || null,
      flavor: flavor || null,
      stocks_count: stock,
    };

    const query = isNew
      ? supabaseClient.from("ProductList").insert(payload)
      : supabaseClient.from("ProductList").update(payload).eq("id", existing.id);

    const { error } = await query;
    if (error) {
      errorEl.textContent = "Save failed: " + error.message;
      errorEl.classList.remove("hidden");
      return;
    }
    showToast(isNew ? "Product added" : "Product updated");
    closeModal(backdrop);
    loadProducts(true);
  });
}

function openDeleteDialog(product) {
  const html = `
    <div class="modal">
      <h3>Delete product</h3>
      <p class="muted">Delete "${escapeHtml(product.product_name)}"? This can't be undone.</p>
      <p class="error-text hidden" id="del-error"></p>
      <div class="row-actions" style="margin-top:6px;">
        <button class="btn btn-ghost btn-sm" id="del-cancel">Cancel</button>
        <button class="btn btn-danger btn-sm" id="del-confirm">Delete</button>
      </div>
    </div>
  `;
  const backdrop = openModal(html);
  $("#del-cancel", backdrop).addEventListener("click", () => closeModal(backdrop));
  $("#del-confirm", backdrop).addEventListener("click", async () => {
    const { error } = await supabaseClient.from("ProductList").delete().eq("id", product.id);
    const errorEl = $("#del-error", backdrop);
    if (error) {
      errorEl.textContent = "Delete failed: " + error.message;
      errorEl.classList.remove("hidden");
      return;
    }
    showToast("Product deleted");
    closeModal(backdrop);
    loadProducts(true);
  });
}

function openReportDialog() {
  const reportText = buildStockReport(state.products);
  const html = `
    <div class="modal">
      <div class="row-between">
        <h3>Stock report</h3>
        <div class="row-actions" style="margin-top:0;">
          <button class="btn btn-ghost btn-sm" id="report-copy">Copy</button>
          <button class="btn btn-ghost btn-sm" id="report-close">Close</button>
        </div>
      </div>
      <div class="report-text">${escapeHtml(reportText)}</div>
    </div>
  `;
  const backdrop = openModal(html);
  $("#report-close", backdrop).addEventListener("click", () => closeModal(backdrop));
  $("#report-copy", backdrop).addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      showToast("Copied to clipboard");
    } catch {
      showToast("Copy failed — select the text manually", true);
    }
  });
}

function buildStockReport(products) {
  const lines = [];
  const now = new Date();
  lines.push("STOCK REPORT");
  lines.push("Generated: " + now.toLocaleString());
  lines.push("=".repeat(32));
  lines.push("");

  const byBrand = {};
  products.forEach((p) => {
    const brand = p.brand && p.brand.trim() ? p.brand : "No Brand";
    (byBrand[brand] ??= []).push(p);
  });

  Object.keys(byBrand).sort().forEach((brand) => {
    const brandProducts = byBrand[brand];
    const brandTotal = brandProducts.reduce((s, p) => s + (p.stocks_count || 0), 0);
    lines.push(`Brand: ${brand}  (Total: ${brandTotal})`);

    const byFlavor = {};
    brandProducts.forEach((p) => {
      const flavor = p.flavor && p.flavor.trim() ? p.flavor : "No Flavor";
      byFlavor[flavor] = (byFlavor[flavor] || 0) + (p.stocks_count || 0);
    });
    Object.keys(byFlavor).sort().forEach((flavor) => {
      lines.push(`   - ${flavor}: ${byFlavor[flavor]}`);
    });
    lines.push("");
  });

  lines.push("-".repeat(32));
  lines.push("Overall Total Stock: " + products.reduce((s, p) => s + (p.stocks_count || 0), 0));
  lines.push("Total Products: " + products.length);

  return lines.join("\n");
}

// ---------- Dashboard (admin only) ----------

async function loadDashboard() {
  const el = $("#dashboard-content");
  el.innerHTML = `<p class="muted">Loading…</p>`;

  const [{ data: products, error: prodErr }, { data: txs, error: txErr }] = await Promise.all([
    supabaseClient.from("ProductList").select("*"),
    supabaseClient.from("SalesTransactions").select("*"),
  ]);

  if (prodErr || txErr) {
    el.innerHTML = `<p class="error-text">Failed to load dashboard: ${escapeHtml((prodErr || txErr).message)}</p>`;
    return;
  }

  state.products = products || [];
  state.transactions = txs || [];
  $("#dashboard-updated").textContent = "Updated " + formatDate(new Date().toISOString());
  renderDashboard();
}

// ---------------------------------------------------------------
// Animated SVG charts (no chart library — hand-built inline SVG so
// the whole thing stays a no-build static site).
//
// Both charts re-run their entrance animation every time they're
// rendered, because renderDashboard() replaces the markup wholesale
// and CSS animations restart on freshly-inserted nodes.
// ---------------------------------------------------------------

// Catmull-Rom → cubic bezier, so the trend line is a smooth curve
// instead of a jagged polyline.
function smoothPath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const t = 0.22;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function peso(n) {
  return "₱" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Sales trend — last 14 days of revenue as an animated gradient area
// chart: the line draws itself left-to-right, the fill fades up under
// it, and each point pops in on a stagger.
function salesTrendChart(txs, dayCount = 14) {
  const days = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const totals = days.map((d) => {
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return txs
      .filter((t) => { const c = new Date(t.created_at); return c >= d && c < next; })
      .reduce((s, t) => s + Number(t.amount || 0), 0);
  });

  const periodTotal = totals.reduce((s, v) => s + v, 0);
  const best = Math.max(...totals);

  // Round the top of the y-axis up to a "nice" number so the gridline
  // labels read 1k / 2k / 3k instead of 913 / 1826 / 2739.
  const rawMax = Math.max(best, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const maxVal = Math.ceil(rawMax / (mag / 2)) * (mag / 2);

  const W = 760, H = 260;
  const padL = 56, padR = 30, padT = 24, padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const pts = totals.map((v, i) => ({
    x: padL + (totals.length === 1 ? plotW / 2 : (i / (totals.length - 1)) * plotW),
    y: padT + plotH - (v / maxVal) * plotH,
    v,
    d: days[i],
  }));

  // horizontal grid + y-axis labels
  const ticks = 4;
  let grid = "";
  for (let i = 0; i <= ticks; i++) {
    const y = padT + (plotH / ticks) * i;
    const val = maxVal - (maxVal / ticks) * i;
    grid += `
      <line class="ct-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" style="animation-delay:${(i * 50)}ms" />
      <text class="ct-ytick" x="${padL - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${val >= 1000 ? "₱" + (val / 1000).toFixed(val % 1000 === 0 ? 0 : 1) + "k" : "₱" + Math.round(val)}</text>`;
  }

  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${padT + plotH} L ${pts[0].x.toFixed(1)} ${padT + plotH} Z`;

  // only label every other day on a 14-day window so it stays legible
  const xLabels = pts.map((p, i) => {
    // Count back from the newest day so "today" always gets a label
    // and the spacing stays even (labelling from the left instead
    // could put the last two labels right on top of each other).
    if (dayCount > 7 && (pts.length - 1 - i) % 2 !== 0) return "";
    const label = p.d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    // Clamp the end labels inward so they can't spill past the chart edge.
    const anchor = i === 0 ? "start" : (i === pts.length - 1 ? "end" : "middle");
    return `<text class="ct-xtick" x="${p.x.toFixed(1)}" y="${H - 14}" text-anchor="${anchor}" style="animation-delay:${600 + i * 30}ms">${label}</text>`;
  }).join("");

  const dots = pts.map((p, i) => {
    const isBest = p.v === best && p.v > 0;
    return `
      <g class="ct-dot-g" style="animation-delay:${500 + i * 55}ms">
        <circle class="ct-dot-halo${isBest ? " ct-dot-best" : ""}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" />
        <circle class="ct-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" />
        <circle class="ct-hit" fill="transparent" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16">
          <title>${p.d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} — ${peso(p.v)}</title>
        </circle>
      </g>`;
  }).join("");

  return `
    <div class="chart-head">
      <div>
        <div class="chart-title">Sales trend</div>
        <div class="chart-sub">Last ${dayCount} days</div>
      </div>
      <div class="chart-total">
        <span class="chart-total-value">${peso(periodTotal)}</span>
        <span class="chart-total-label">total revenue</span>
      </div>
    </div>
    <svg class="chart-svg trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Sales trend for the last ${dayCount} days">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.34" />
          <stop offset="55%"  stop-color="var(--accent)" stop-opacity="0.12" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="var(--mint-text)" />
          <stop offset="55%"  stop-color="var(--accent)" />
          <stop offset="100%" stop-color="var(--blue-text)" />
        </linearGradient>
        <filter id="trendGlow" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      ${grid}
      <path class="ct-area" d="${area}" fill="url(#trendFill)" />
      <path class="ct-line" d="${line}" fill="none" stroke="url(#trendStroke)" filter="url(#trendGlow)" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

// Top products — animated horizontal bar chart. Bars grow from the
// left on a stagger, with a shine sweep and a rank badge each.
function topProductsChart(entries) {
  if (!entries.length) return `<p class="muted">No sales yet.</p>`;

  const max = entries[0][1] || 1;
  const rowH = 54, padT = 8, padR = 60, padL = 40;
  const W = 760;
  const H = padT + entries.length * rowH;
  const trackW = W - padL - padR;

  const rows = entries.map(([name, qty], i) => {
    const w = Math.max(6, (qty / max) * trackW);
    const y = padT + i * rowH;
    const barY = y + 22;
    const delay = 120 + i * 120;
    return `
      <g class="tp-row">
        <text class="tp-rank" x="0" y="${barY + 13}" style="animation-delay:${delay}ms">${i + 1}</text>
        <text class="tp-name" x="${padL}" y="${y + 14}" style="animation-delay:${delay}ms">${escapeHtml(name.length > 46 ? name.slice(0, 45) + "…" : name)}</text>
        <rect class="tp-track" fill="var(--surface-2)" x="${padL}" y="${barY}" width="${trackW}" height="20" rx="10" />
        <g class="tp-bar-g" style="animation-delay:${delay}ms">
          <rect class="tp-bar" x="${padL}" y="${barY}" width="${w.toFixed(1)}" height="20" rx="10" fill="url(#tpBar${i % 4})">
            <title>${escapeHtml(name)} — ${qty} sold</title>
          </rect>
          <rect class="tp-shine" x="${padL}" y="${barY}" width="${w.toFixed(1)}" height="20" rx="10" style="animation-delay:${delay + 500}ms" />
        </g>
        <text class="tp-value" x="${(padL + w + 12).toFixed(1)}" y="${barY + 14}" style="animation-delay:${delay + 350}ms">${qty}</text>
      </g>`;
  }).join("");

  return `
    <svg class="chart-svg tp-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Top products by units sold">
      <defs>
        <linearGradient id="tpBar0" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#1E7A52" /><stop offset="100%" stop-color="#3FBE86" />
        </linearGradient>
        <linearGradient id="tpBar1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#2C6FD1" /><stop offset="100%" stop-color="#5FA8F5" />
        </linearGradient>
        <linearGradient id="tpBar2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#C67C2E" /><stop offset="100%" stop-color="#F0AF5E" />
        </linearGradient>
        <linearGradient id="tpBar3" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#B4495F" /><stop offset="100%" stop-color="#EE7E95" />
        </linearGradient>
        <linearGradient id="tpShine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="#fff" stop-opacity="0" />
          <stop offset="50%"  stop-color="#fff" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${rows}
    </svg>
  `;
}

function barRow(label, value, max, valueText) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return `
    <div class="bar-row">
      <div class="bar-row-top">
        <span class="bar-label">${escapeHtml(label)}</span>
        <span class="bar-value">${escapeHtml(valueText)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>
  `;
}

function renderDashboard() {
  const txs = state.transactions;
  const products = state.products;

  const totalRevenue = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalQtySold = txs.reduce((s, t) => s + Number(t.quntity || 0), 0);
  const totalStock = products.reduce((s, p) => s + (p.stocks_count || 0), 0);
  const outOfStock = products.filter((p) => (p.stocks_count || 0) === 0).length;
  const lowStock = products.filter((p) => (p.stocks_count || 0) > 0 && p.stocks_count <= 5).length;

  const byProduct = {};
  txs.forEach((t) => { byProduct[t.ProductName] = (byProduct[t.ProductName] || 0) + Number(t.quntity || 0); });
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const byPerson = {};
  txs.forEach((t) => { byPerson[t.SalesPerson] = (byPerson[t.SalesPerson] || 0) + Number(t.amount || 0); });
  const topPeople = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxPersonRevenue = topPeople.length ? topPeople[0][1] : 0;

  const recent = [...txs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  $("#dashboard-content").innerHTML = `
    <div class="dash-grid">
      <div class="dash-stat dash-color-pink">
        <div class="dash-stat-icon">${ICONS.wallet}</div>
        <div class="dash-stat-label">Total revenue</div>
        <div class="dash-stat-value">₱${totalRevenue.toFixed(2)}</div>
      </div>
      <div class="dash-stat dash-color-orange">
        <div class="dash-stat-icon">${ICONS.list}</div>
        <div class="dash-stat-label">Transactions</div>
        <div class="dash-stat-value">${txs.length}</div>
      </div>
      <div class="dash-stat dash-color-mint">
        <div class="dash-stat-icon">${ICONS.box}</div>
        <div class="dash-stat-label">Units sold</div>
        <div class="dash-stat-value">${totalQtySold}</div>
      </div>
      <div class="dash-stat dash-color-blue">
        <div class="dash-stat-icon">${ICONS.bars}</div>
        <div class="dash-stat-label">Stock on hand</div>
        <div class="dash-stat-value">${totalStock}</div>
      </div>
      <div class="dash-stat dash-color-red">
        <div class="dash-stat-icon">${ICONS.alertTriangle}</div>
        <div class="dash-stat-label">Out of stock</div>
        <div class="dash-stat-value">${outOfStock}</div>
      </div>
      <div class="dash-stat dash-color-amber">
        <div class="dash-stat-icon">${ICONS.alertCircle}</div>
        <div class="dash-stat-label">Low stock (≤5)</div>
        <div class="dash-stat-value">${lowStock}</div>
      </div>
    </div>

    <div class="card chart-card">
      ${salesTrendChart(txs)}
    </div>

    <div class="dash-columns">
      <div class="dash-main">
        <div class="card chart-card">
          <div class="chart-head">
            <div>
              <div class="chart-title">Top products</div>
              <div class="chart-sub">By units sold</div>
            </div>
          </div>
          ${topProductsChart(topProducts)}
        </div>

        <div class="card">
          <h2>Top salespeople</h2>
          ${topPeople.length
            ? topPeople.map(([name, rev]) => barRow(name, rev, maxPersonRevenue, "₱" + rev.toFixed(2))).join("")
            : `<p class="muted">No sales yet.</p>`}
        </div>
      </div>

      <div class="dash-side">
        <div class="card">
          <h2>Recent sales</h2>
          ${recent.length
            ? recent.map((t) => `
                <div class="tx-row" style="margin-bottom:8px;">
                  <div class="row-icon ri-sale">${ICONS.sale}</div>
                  <div class="row-body">
                    <div class="top-line"><span>${escapeHtml(t.ProductName)}</span><span class="amount">₱${Number(t.amount).toFixed(2)}</span></div>
                    <div class="meta"><span class="tag-person">${escapeHtml(t.SalesPerson)}</span><span>${formatDate(t.created_at)}</span></div>
                  </div>
                </div>
              `).join("")
            : `<p class="muted">No transactions yet.</p>`}
        </div>
      </div>
    </div>
  `;
}

// ---------- Users (admin only) ----------
// Calls the "admin-users" Edge Function, which holds the service_role
// key server-side and re-checks is_admin() before touching auth.users.

async function callAdminUsers(action, payload = {}) {
  const { data, error } = await supabaseClient.functions.invoke("admin-users", {
    body: { action, ...payload },
  });
  if (error) {
    // supabase-js puts the function's own JSON error body on error.context in v2
    let message = error.message || "Request failed";
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch { /* ignore, fall back to error.message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadUsers() {
  const listEl = $("#user-list");
  listEl.innerHTML = `<p class="muted">Loading…</p>`;

  try {
    const data = await callAdminUsers("list");
    state.users = data.users || [];
    renderUsers();
  } catch (err) {
    listEl.innerHTML = `<p class="error-text">Failed to load users: ${escapeHtml(err.message)}
      <br/>Make sure the "admin-users" Edge Function is deployed (see README.md).</p>`;
  }
}

function renderUsers() {
  const listEl = $("#user-list");
  $("#user-count").textContent = `${state.users.length} user${state.users.length === 1 ? "" : "s"}`;

  if (state.users.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><p class="muted">No users yet.</p></div>`;
    return;
  }

  listEl.innerHTML = state.users.map((u) => {
    const isAdminUser = ADMIN_EMAILS.includes(u.email);
    const isSelf = u.id === state.session.user.id;
    return `
      <div class="user-row" data-id="${u.id}">
        <div class="row-icon ri-person">${initialsFor(u.email)}</div>
        <div class="row-body">
          <div class="name">
            ${escapeHtml(u.email)}
            ${isAdminUser ? `<span class="role-chip">ADMIN</span>` : ""}
          </div>
          <div class="subtitle">Joined ${formatDate(u.created_at)}${u.last_sign_in_at ? " · last sign-in " + formatDate(u.last_sign_in_at) : " · never signed in"}</div>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm edit-password">Change password</button>
            ${isSelf ? "" : `<button class="btn btn-danger btn-sm delete-user">Delete</button>`}
          </div>
        </div>
      </div>
    `;
  }).join("");

  $all(".edit-password", listEl).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".user-row").dataset.id;
      const user = state.users.find((u) => u.id === id);
      openPasswordDialog(user);
    });
  });
  $all(".delete-user", listEl).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".user-row").dataset.id;
      const user = state.users.find((u) => u.id === id);
      openDeleteUserDialog(user);
    });
  });
}

function openUserDialog() {
  const html = `
    <div class="modal">
      <h3>Add user</h3>
      <div class="field"><label>Email</label>
        <input type="email" id="ud-email" autocomplete="off" />
      </div>
      <div class="field"><label>Temporary password</label>
        <input type="password" id="ud-password" autocomplete="new-password" minlength="6" />
      </div>
      <p class="muted" style="margin-top:-6px;">Share this password with them directly — they can change it later from the Users tab (ask an admin) or their own account settings.</p>
      <p class="error-text hidden" id="ud-error"></p>
      <div class="row-actions" style="margin-top:6px;">
        <button class="btn btn-ghost btn-sm" id="ud-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="ud-save">Create user</button>
      </div>
    </div>
  `;
  const backdrop = openModal(html);
  $("#ud-cancel", backdrop).addEventListener("click", () => closeModal(backdrop));
  $("#ud-save", backdrop).addEventListener("click", async () => {
    const email = $("#ud-email", backdrop).value.trim();
    const password = $("#ud-password", backdrop).value;
    const errorEl = $("#ud-error", backdrop);
    const saveBtn = $("#ud-save", backdrop);

    if (!email) { errorEl.textContent = "Email is required"; errorEl.classList.remove("hidden"); return; }
    if (!password || password.length < 6) { errorEl.textContent = "Password must be at least 6 characters"; errorEl.classList.remove("hidden"); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = "Creating…";
    try {
      await callAdminUsers("create_user", { email, password });
      showToast("User created");
      closeModal(backdrop);
      loadUsers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Create user";
    }
  });
}

function openPasswordDialog(user) {
  const html = `
    <div class="modal">
      <h3>Change password</h3>
      <p class="muted" style="margin-top:-8px;">${escapeHtml(user.email)}</p>
      <div class="field"><label>New password</label>
        <input type="password" id="pw-password" autocomplete="new-password" minlength="6" />
      </div>
      <p class="error-text hidden" id="pw-error"></p>
      <div class="row-actions" style="margin-top:6px;">
        <button class="btn btn-ghost btn-sm" id="pw-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="pw-save">Update password</button>
      </div>
    </div>
  `;
  const backdrop = openModal(html);
  $("#pw-cancel", backdrop).addEventListener("click", () => closeModal(backdrop));
  $("#pw-save", backdrop).addEventListener("click", async () => {
    const password = $("#pw-password", backdrop).value;
    const errorEl = $("#pw-error", backdrop);
    const saveBtn = $("#pw-save", backdrop);

    if (!password || password.length < 6) { errorEl.textContent = "Password must be at least 6 characters"; errorEl.classList.remove("hidden"); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = "Updating…";
    try {
      await callAdminUsers("update_password", { user_id: user.id, password });
      showToast("Password updated");
      closeModal(backdrop);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Update password";
    }
  });
}

function openDeleteUserDialog(user) {
  const html = `
    <div class="modal">
      <h3>Delete user</h3>
      <p class="muted">Delete "${escapeHtml(user.email)}"? They'll immediately lose access. This can't be undone.</p>
      <p class="error-text hidden" id="du-error"></p>
      <div class="row-actions" style="margin-top:6px;">
        <button class="btn btn-ghost btn-sm" id="du-cancel">Cancel</button>
        <button class="btn btn-danger btn-sm" id="du-confirm">Delete</button>
      </div>
    </div>
  `;
  const backdrop = openModal(html);
  $("#du-cancel", backdrop).addEventListener("click", () => closeModal(backdrop));
  $("#du-confirm", backdrop).addEventListener("click", async () => {
    const errorEl = $("#du-error", backdrop);
    try {
      await callAdminUsers("delete_user", { user_id: user.id });
      showToast("User deleted");
      closeModal(backdrop);
      loadUsers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove("hidden");
    }
  });
}

// ---------- modal helpers ----------

function openModal(innerHtml) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = innerHtml;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal(backdrop);
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

function closeModal(backdrop) {
  backdrop.remove();
}

init();
