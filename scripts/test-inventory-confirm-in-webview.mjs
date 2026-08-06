// BUG-137 — thu pham that su cua "kho khong dong bo".
//
// Trong Android WebView, `window.confirm()` chi hoat dong khi app chu tu cai
// `WebChromeClient.onJsConfirm()`. Zalo/Facebook khong cai, nen ham TRA `false`
// NGAY LAP TUC ma khong hien gi ca — dung cung co che da lam `getCurrentPosition()`
// chet cam o BUG-107, tren dung nhom may do (auth.sessions.user_agent cho thay
// SM-A235F chay WebView trong Zalo).
//
// Voi `if (!window.confirm(...)) return`, man Kho thoat ra: khong ghi gi, khong
// goi mang, KHONG BAO GI. Ca truong tuong da luu; may khac van hien so cu.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// UA that lay tu auth.sessions cua may gay loi (BUG-107).
const UA_ZALO_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; SM-A235F Build/UP1A.231005.007;) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36 Zalo'
const UA_CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/119.0.0.0 Mobile Safari/537.36'

async function loadDeviceReadiness() {
  const source = await readFile(new URL('../src/lib/deviceReadiness.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

/** Dung moi truong trinh duyet gia: UA + hanh vi cua window.confirm. */
function setBrowser(userAgent, confirmImpl) {
  // Node 25 khai bao `navigator` la getter chi doc nen phai dinh nghia de.
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent }, configurable: true, writable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: { confirm: confirmImpl, isSecureContext: true }, configurable: true, writable: true,
  })
}

const { confirmRisky, confirmBlockedMessage, detectDeviceEnvironment } = await loadDeviceReadiness()

// ── 1. WebView Zalo: confirm tra false tuc thi ⇒ phai la 'suppressed', KHONG
//      duoc lan sang 'declined' (nguoi dung dau co bam gi).
setBrowser(UA_ZALO_WEBVIEW, () => false)
assert.equal(detectDeviceEnvironment().isInAppBrowser, true, 'UA Zalo WebView phai bi nhan dien la in-app')
assert.equal(confirmRisky('Dat lai ton kho?'), 'suppressed')

// ── 2. Thong bao cho 'suppressed' phai noi ro CHUA lam gi + chi duong thoat ra.
const blocked = confirmBlockedMessage('suppressed', 'Sửa tồn')
assert.match(blocked, /CHƯA được thực hiện/, 'Phai noi thang la chua lam gi')
assert.match(blocked, /Chrome|Safari/, 'Phai chi duong mo bang trinh duyet that')
assert.match(blocked, /Zalo/i, 'Phai goi dung ten app dang boc WebView')

// ── 3. Chrome that: nguoi dung bam Huy ⇒ 'declined', thong bao khac han.
setBrowser(UA_CHROME_ANDROID, () => false)
assert.equal(detectDeviceEnvironment().isInAppBrowser, false)
assert.equal(confirmRisky('Dat lai ton kho?'), 'declined')
assert.match(confirmBlockedMessage('declined', 'Sửa tồn'), /đã hủy/i)

// ── 4. Chrome that: bam Dong y ⇒ 'accepted'.
setBrowser(UA_CHROME_ANDROID, () => true)
assert.equal(confirmRisky('Dat lai ton kho?'), 'accepted')

// ── 5. WebView bam Dong y that (app chu co cai onJsConfirm) van phai chay.
setBrowser(UA_ZALO_WEBVIEW, () => true)
assert.equal(confirmRisky('Dat lai ton kho?'), 'accepted')

// ── 6. WebView nem loi thay vi tra false ⇒ van la 'suppressed', khong vo tinh
//      coi la dong y va cung khong lam vo man hinh.
setBrowser(UA_ZALO_WEBVIEW, () => { throw new Error('JS dialogs disabled') })
assert.equal(confirmRisky('Dat lai ton kho?'), 'suppressed')

// ── 7. Man Kho khong duoc con `window.confirm` tran ⇒ moi loi thoat deu co
//      thong bao. Day moi la thu chan tai phat lo hong.
const page = await readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8')
assert.ok(!/window\.confirm/.test(page),
  'InventoryPage con window.confirm tran: thao tac se lai thoat ra im lang trong WebView')
const risky = page.match(/confirmRisky\(/g) || []
assert.ok(risky.length >= 5, `Phai boc du 5 diem xac nhan cua man Kho, dang co ${risky.length}`)
// Moi lan tu choi deu phai bao cho nguoi dung.
const blockedMsgs = page.match(/confirmBlockedMessage\(/g) || []
assert.equal(blockedMsgs.length, risky.length,
  'Moi confirmRisky phai co mot confirmBlockedMessage di kem — khong duoc return trang')

console.log('INVENTORY_CONFIRM_IN_WEBVIEW_OK')
