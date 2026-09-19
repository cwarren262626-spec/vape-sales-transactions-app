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
  users: [],
};

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

  $all("nav.bottom-tabs button").forEach((btn) => {
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
  $("#user-filter").addEventListener("change", renderTransactions);
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
  const filtered = selectedPerson ? data.filter((t) => t.SalesPerson === selectedPerson) : data;

  $("#tx-count").textContent = data.length === 0
    ? ""
    : `Showing ${filtered.length} of ${data.length} transactions`;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><p class="muted">${data.length === 0 ? "No transactions yet." : "No transactions from this user."}</p></div>`;
    return;
  }

  listEl.innerHTML = filtered.map((tx) => `
    <div class="tx-row" data-id="${tx.id}">
      <div class="top-line">
        <span>${escapeHtml(tx.ProductName)}</span>
        <span class="amount">₱${Number(tx.amount).toFixed(2)}</span>
      </div>
      <div class="meta">
        <span>Qty ${tx.quntity}</span>
        <span class="tag-person">${escapeHtml(tx.SalesPerson)}</span>
        <span>${formatDate(tx.created_at)}</span>
      </div>
      ${tx.remarks ? `<div class="meta">${escapeHtml(tx.remarks)}</div>` : ""}
      ${state.isAdmin ? `
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm edit-tx">Edit</button>
          <button class="btn btn-ghost btn-sm delete-tx">Delete</button>
        </div>` : ""}
    </div>
  `).join("");

  if (state.isAdmin) {
    $all(".edit-tx", listEl).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.closest(".tx-row").dataset.id;
        const tx = data.find((t) => String(t.id) === id);
        openTransactionEditDialog(tx);
      });
    });
    $all(".delete-tx", listEl).forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const row = e.target.closest(".tx-row");
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
    const stockClass = p.stocks_count > 0 ? "stock-ok" : "stock-out";
    return `
      <div class="product-row" data-id="${p.id}">
        <div class="name">${escapeHtml(p.product_name)}</div>
        ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ""}
        <div class="stock-line ${stockClass}">Stock: ${p.stocks_count}</div>
        ${state.isAdmin ? `
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm edit-product">Edit</button>
            <button class="btn btn-ghost btn-sm delete-product">Delete</button>
          </div>` : ""}
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
  const maxProductQty = topProducts.length ? topProducts[0][1] : 0;

  const byPerson = {};
  txs.forEach((t) => { byPerson[t.SalesPerson] = (byPerson[t.SalesPerson] || 0) + Number(t.amount || 0); });
  const topPeople = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxPersonRevenue = topPeople.length ? topPeople[0][1] : 0;

  const recent = [...txs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  $("#dashboard-content").innerHTML = `
    <div class="dash-grid">
      <div class="dash-stat">
        <div class="dash-stat-label">Total revenue</div>
        <div class="dash-stat-value">₱${totalRevenue.toFixed(2)}</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-label">Transactions</div>
        <div class="dash-stat-value">${txs.length}</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-label">Units sold</div>
        <div class="dash-stat-value">${totalQtySold}</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-label">Stock on hand</div>
        <div class="dash-stat-value">${totalStock}</div>
      </div>
      <div class="dash-stat ${outOfStock > 0 ? "dash-stat-danger" : ""}">
        <div class="dash-stat-label">Out of stock</div>
        <div class="dash-stat-value">${outOfStock}</div>
      </div>
      <div class="dash-stat ${lowStock > 0 ? "dash-stat-warn" : ""}">
        <div class="dash-stat-label">Low stock (≤5)</div>
        <div class="dash-stat-value">${lowStock}</div>
      </div>
    </div>

    <div class="card">
      <h2>Top products</h2>
      ${topProducts.length
        ? topProducts.map(([name, qty]) => barRow(name, qty, maxProductQty, qty + " sold")).join("")
        : `<p class="muted">No sales yet.</p>`}
    </div>

    <div class="card">
      <h2>Top salespeople</h2>
      ${topPeople.length
        ? topPeople.map(([name, rev]) => barRow(name, rev, maxPersonRevenue, "₱" + rev.toFixed(2))).join("")
        : `<p class="muted">No sales yet.</p>`}
    </div>

    <div class="card">
      <h2>Recent activity</h2>
      ${recent.length
        ? recent.map((t) => `
            <div class="tx-row" style="margin-bottom:8px;">
              <div class="top-line"><span>${escapeHtml(t.ProductName)}</span><span class="amount">₱${Number(t.amount).toFixed(2)}</span></div>
              <div class="meta"><span class="tag-person">${escapeHtml(t.SalesPerson)}</span><span>${formatDate(t.created_at)}</span></div>
            </div>
          `).join("")
        : `<p class="muted">No transactions yet.</p>`}
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
