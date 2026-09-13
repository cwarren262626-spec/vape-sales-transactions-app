// ---------------------------------------------------------------
// KuslagVape — Sales Transactions web app
// Vanilla JS + Supabase JS v2. See config.js for credentials.
// ---------------------------------------------------------------

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  isAdmin: false,
  activeTab: "new",
  products: [],
  selectedProduct: null,
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
  $("#report-btn").addEventListener("click", openReportDialog);
  $("#brand-filter").addEventListener("change", renderProducts);
}

function applyAuthState() {
  const loggedIn = !!state.session;
  $("#login-view").classList.toggle("hidden", loggedIn);
  $("#app-view").classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    const email = state.session.user.email || "";
    state.isAdmin = ADMIN_EMAILS.includes(email);
    $("#current-email").textContent = email;
    $("#admin-only-nav").classList.toggle("hidden", false);
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
  btn.textContent = "Sign In";

  if (error) {
    errorEl.textContent = "Login failed: " + error.message;
  }
}

// ---------- tabs ----------

function switchTab(tab) {
  state.activeTab = tab;
  $all("nav.bottom-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $all("main.screen > section").forEach((s) => s.classList.add("hidden"));
  $("#screen-" + tab).classList.remove("hidden");

  if (tab === "transactions") loadTransactions();
  if (tab === "products") loadProducts(true);
  if (tab === "new") loadProducts();
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

  const { error: insertError } = await supabaseClient.from("SalesTransactions").insert({
    ProductName: displayName(product),
    quntity: qty,
    amount: amount,
    SalesPerson: state.session.user.email,
    remarks: remarks || null,
  });

  if (insertError) {
    errorEl.textContent = "Save failed: " + insertError.message;
    btn.disabled = false;
    btn.textContent = "Save";
    return;
  }

  const newStock = Math.max(product.stocks_count - qty, 0);
  const { error: updateError } = await supabaseClient
    .from("ProductList")
    .update({ stocks_count: newStock })
    .eq("id", product.id);

  if (updateError) {
    showToast("Transaction saved, but stock update failed: " + updateError.message, true);
  } else {
    showToast("Transaction saved!");
  }

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

  if (!data || data.length === 0) {
    listEl.innerHTML = `<p class="muted">No transactions yet.</p>`;
    return;
  }

  listEl.innerHTML = data.map((tx) => `
    <div class="tx-row" data-id="${tx.id}">
      <div class="top-line">
        <span>${escapeHtml(tx.ProductName)}</span>
        <span class="amount">₱${Number(tx.amount).toFixed(2)}</span>
      </div>
      <div class="meta">Qty: ${tx.quntity} · ${escapeHtml(tx.SalesPerson)} · ${formatDate(tx.created_at)}</div>
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
      <h3>Edit Transaction</h3>
      <div class="field"><label>Product Name</label>
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
  brandSelect.parentElement.classList.toggle("hidden", brands.length === 0);

  const selectedBrand = brandSelect.value;
  const filtered = selectedBrand ? state.products.filter((p) => p.brand === selectedBrand) : state.products;
  const totalStock = filtered.reduce((sum, p) => sum + (p.stocks_count || 0), 0);

  $("#product-total-stock").textContent = `Total Stock: ${totalStock}`;
  $("#product-count").textContent = `Showing ${filtered.length} of ${state.products.length} products`;
  $("#report-btn").classList.toggle("hidden", state.products.length === 0);
  $("#add-product-fab").classList.toggle("hidden", !state.isAdmin);

  const listEl = $("#product-list");
  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="muted">${state.products.length === 0 ? "No products yet." : "No products match this brand."}</p>`;
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
      <h3>${isNew ? "Add Product" : "Edit Product"}</h3>
      <div class="field"><label>Product Name</label>
        <input type="text" id="pd-name" value="${existing ? escapeHtml(existing.product_name) : ""}" />
      </div>
      <div class="field"><label>Brand</label>
        <input type="text" id="pd-brand" value="${existing ? escapeHtml(existing.brand || "") : ""}" />
      </div>
      <div class="field"><label>Flavor</label>
        <input type="text" id="pd-flavor" value="${existing ? escapeHtml(existing.flavor || "") : ""}" />
      </div>
      <div class="field"><label>Stock Count</label>
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
      <h3>Delete Product</h3>
      <p>Delete "${escapeHtml(product.product_name)}"? This can't be undone.</p>
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
        <h3>Stock Report</h3>
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
