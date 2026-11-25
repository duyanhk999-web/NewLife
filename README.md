# Cuộc Sống Ảo (Đô Thị Ảo) — M4 Build

Game Roleplay đô thị 2D top-down trên trình duyệt (PC & điện thoại), hỗ trợ **chơi đơn offline** (`localStorage`) và **multiplayer thời gian thực** (Colyseus `0.15.0`), dùng chung bộ luật ở `shared/`.

## Công nghệ

- **Client**: PixiJS **v8.13.0** (CDN), JavaScript thuần, không build step; Hybrid UI (Canvas/WebGL cho bản đồ, HUD, minimap, joystick; DOM overlay cho chat IME, Shop, ATM, Nghề nghiệp, Nhà trọ, mini-game hồi sinh).
- **Server**: Node.js `>= 20`, Colyseus `0.15.0` (`server/index.js`, `server/rooms/CityRoom.js`).
- **Database (chuẩn bị cho M5)**: Supabase PostgreSQL migrations (`supabase/migrations/001_m2.sql`..`003_rpc.sql`). Hiện server Colyseus vẫn lưu trạng thái phiên trong RAM.

## Trạng thái các Milestone (M0 → M4)

| Milestone | Nội dung chính | Trạng thái |
|---|---|---|
| **M0** | Bản đồ & di chuyển, camera zoom, ngày/đêm, HUD Canvas, minimap, Radial Menu, NPC dạo | Đã xong |
| **M1** | Colyseus server (`city` room, maxClients 8, 20 Hz), authoritative movement, chat 3 kênh + Bot AI (`shared/botBrain.js`) | Đã xong |
| **M2** | Kinh tế cốt lõi: starter grant **80.000đ** (1 lần), Cửa Hàng 24/7 (giá ngày/đêm), ATM (1k–200k/lần, tối đa 500k/ngày), Supabase SQL RPC | Xong bản local + server stub; chờ Auth M5 |
| **M3** | Sinh tồn (ngất mất 50% Cash, về Bệnh viện phí 10k + 50% Cash còn lại), Bác sĩ cứu người (25k, cooldown 60s, cap 2 lần/60p/cặp), Shipper đa điểm (Kho + 4 shop), SFX & VFX | Đã xong |
| **M4** | Map v2 **4.800×4.800 px** (23 tòa nhà, 2 vườn hoa, traffic, thú nuôi), Xe đạp (250k, 234 px/s) & Xe máy (1M, 324 px/s), Taxi NPC & người chơi, Nhà trọ (50k/24h, rương 10 ô), mini-game cấp cứu nhịp tim | Đã xong (online lưu theo phiên RAM; hồi sinh tại phòng trọ & tải trọng kg để M5) |

## Chạy thử

### 1. Chơi đơn (Offline) hoặc kết nối Client
```bash
cd do-thi-ao
python -m http.server 8000
# Mở http://localhost:8000/ (thêm ?test=1 để bật bảng TEST offline)
```

### 2. Chạy Server Multiplayer (Colyseus)
```bash
cd do-thi-ao/server
npm install
npm start
# Mặc định lắng nghe tại ws://localhost:2567 (health check: GET /health)
```

## Kiểm thử

```bash
# Kiểm tra cú pháp & toàn bộ test client (từ thư mục gốc repo)
node test/sfx-harness.js
node test/vfx-harness.js
node test/map-render-check.js
node test/hud-layout-check.js
node test/tap-check.js
node test/animal-flip-check.js
node test/traffic-check.js
node test/test-mode-check.js
node test/vehicle-check.js

# Bộ test server (khởi chạy server thật + 2 client Colyseus)
cd server && npm test
```

## Cấu trúc thư mục

- `index.html` — Trang chính, CDN scripts, CSS và các panel DOM
- `shared/` — Single source of truth (UMD): `colliders.js`, `m3.js`, `botBrain.js`
- `src/` — Client modules: `main.js`, `net.js`, `economy.js`, `jobs.js`, `sfx.js`, `vfx.js`
- `server/` — Colyseus server (`index.js`, `schema.js`, `rooms/CityRoom.js`, `test/test.js`)
- `supabase/migrations/` — Schema, RLS và atomic RPCs cho PostgreSQL
- `test/` — Các headless check cho HUD, render, SFX, VFX, tap, vehicle, traffic, test-mode
- `docs/` — Ghi chú kỹ thuật & lịch sử kiểm toán (`m4.md`, `m3-skills-audit.md`, `m3-sfx.md`, `rename-vfx.md`)
