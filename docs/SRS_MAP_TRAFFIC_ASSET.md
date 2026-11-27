# SRS: Cải Tiến Bản Đồ, Hệ Thống Giao Thông Và Asset — NewLife
**Ngày ghi nhận:** 26/11/2026  
**Tác giả:** @Duyanh  
**Commit cơ sở:** `0711eea`

---

## 1. Tóm Tắt & Mục Tiêu
Quảng trường trung tâm hiện bị xe cơ giới cắt ngang do hai trục đường chính chạy xuyên thẳng qua giữa đài phun nước. Bản cải tiến này:
1. Chuyển hai trục đường giữa thành **đường vòng vuông bao quanh quảng trường** (từ toạ độ 1950 đến 2910), giải phóng hoàn toàn không gian đi bộ bên trong quảng trường.
2. Nâng cấp hệ thống giao thông thành đồ thị di chuyển quy chuẩn: xe cộ dừng đỗ theo đèn tín hiệu giao thông (chu kỳ 33,5s), người đi bộ qua đường theo vạch kẻ ngựa vằn khi có đèn xanh cho người đi bộ.
3. Dời vị trí các tòa nhà, vườn hoa và POI để tránh đè lên lòng đường hoặc vỉa hè.
4. Vá khẩn cấp 2 lỗ hổng bảo mật tiền tệ trong database Supabase (`006_lock_money.sql`).
5. Chuẩn hóa kế hoạch vẽ lại asset 2D (nhìn thẳng từ trên xuống - top-down orthographic) và dọn dẹp dung lượng thừa.

---

## 2. Các Lỗi Hiện Tại & Nguyên Nhân (Gốc Commit `0711eea`)

| Hiện tượng | Nguyên nhân | Vị trí mã nguồn |
| :--- | :--- | :--- |
| **Xe chạy cắt ngang quảng trường, đâm qua đài phun nước** | Trục đường 2340–2520 chạy xuyên quảng trường. Ảnh quảng trường chỉ vẽ đè lên, xe vẫn chạy ở $x/y = 2385$ và $2475$. | `shared/colliders.js` (dòng 18–22) |
| **Người đi bộ đi lung tung** | Chọn điểm đích ngẫu nhiên rồi đi thẳng. Mô phỏng 20.000 chuyến: 91,8% có băng qua đường bừa bãi. | `updateNPCs` (`main.js` 2138), `_wanderNpc` (`CityRoom.js` 1833) |
| **Xe chạy lùi** | Ảnh ô tô quay đầu sang trái, code coi là quay phải. Xe máy sai trên đường dọc. | `main.js` 541–542 |
| **Dải vỉa hè đè ngang lòng đường** | Vẽ xong đường này mới vẽ vỉa hè đường kế tiếp, nên vỉa hè phủ lên lớp nhựa đường. | `main.js` 630–645 |
| **Đồn Công An hiện mặt anh công an** | Khóa `police` bị khai báo 2 lần trong `ASSET_FILES`, ảnh chân dung ghi đè ảnh tòa nhà. | `main.js` 189 và 212 |
| **Không có đèn đường nào** | Lưới tọa độ $200 + 400k$ không bao giờ rơi vào đường, vòng lặp tạo ra 0 cột đèn. | `main.js` 801 |
| **Minimap vẽ đường lệch 90px** | Bị cộng thừa nửa bề rộng đường. | `main.js` 1683–1684 |
| **Lỗi bố trí khác** | Rào 2 vườn hoa đè lên đường; Khu Nhà Trọ đè góc quảng trường; 1 con mèo xuất hiện trong kho; ~15% điểm trồng cây rơi lên vỉa hè. | Dữ liệu khởi tạo môi trường |

---

## 3. Bản Đồ Mới (So Sánh Thông Số)

Hai trục giữa dừng ở một đường vòng vuông quanh quảng trường. Quảng trường giữ nguyên kích thước $660 \times 660\text{ px}$, tâm dời về $(2430, 2430)$ cho khớp tim đường.

| Thông số | Cũ | Mới |
| :--- | :--- | :--- |
| **Bề rộng vỉa hè** | $40\text{ px}$ | **$60\text{ px}$** |
| **Quảng trường ($x, y$)** | $(2070, 2070)$ | **$(2100, 2100)$** (Tâm: $2430, 2430$) |
| **Đường vòng (tim đường)** | Không có | **$1950 \text{ đến } 2910$** |
| **Điểm hồi sinh** | $(2400, 2625)$ | **$(2430, 2650)$** |
| **Ngân hàng** | $(1425, 1425)$ | **$(1400, 1400)$** |
| **Cửa hàng tiện lợi 24/7** | $(2670, 1425)$ | **$(3000, 1400)$** |
| **Showroom xe máy** | $(1425, 2670)$ | **$(1400, 3100)$** |
| **Khu Nhà Trọ** | $(2670, 2670)$ | **$(2990, 3080)$** |
| **Đồn Công An** | $(3720, 600)$ | **$(3790, 600)$** |
| **Chòi vọng cảnh** | $(4200, 600)$ | **$(4390, 600)$** |
| **Quán cà phê** | $(2520, 4230)$ | **$(2580, 4230)$** |
| **Vườn hoa A** | $(600, 2400)$ | **$(440, 3050)$** |
| **Vườn hoa B** | $(3000, 600)$ | **$(2860, 600)$** |
| **Bãi đỗ xe mới mua** | Cũ | **$(1960, 3380)$** (Cạnh Showroom) |

---

## 4. Luật Giao Thông Mới & Chu Kỳ Đèn Tín Hiệu

Người đi bộ và xe di chuyển theo đồ thị quy định trong `shared/roadnet.js`.

* **NPC và bot**: Đi từ góc vỉa hè này sang góc kế tiếp. Chỉ qua đường trên vạch ngựa vằn khi đèn người đi bộ chuyển sang màu xanh và còn đủ thời gian bước qua.
* **Xe cộ (20 xe)**: Chạy làn bên phải, giữ khoảng cách, dừng trước vạch khi đèn đỏ, quay đầu ở mép bản đồ.
* **Giao lộ**: Phân luồng ưu tiên một hướng tại một thời điểm để xe rẽ trái không đâm nhau.
* **Người đứng trên đường**: Xe tự động phanh hãm lại (kể cả khi chướng ngại là người chơi).
* **Động vật (chó, mèo)**: Chỉ lang thang trong ô cỏ, không bao giờ băng qua đường.
* **Vạch kẻ đường**: Vạch đôi vàng giữa đường, vạch trắng mép đường, vạch dừng và vạch ngựa vằn tại 12 giao lộ.

### Chu kỳ đèn tín hiệu giao thông (33,5 giây)

| Pha | Đèn xe đường ngang | Đèn xe đường dọc | Đèn người đi bộ | Thời gian (giây) |
| :---: | :---: | :---: | :---: | :---: |
| **1** | Xanh $\rightarrow$ Vàng | Đỏ | Đỏ | $8\text{s} + 2\text{s}$ |
| **2** | Đỏ | Đỏ | Đỏ | $2\text{s}$ |
| **3** | Đỏ | Xanh $\rightarrow$ Vàng | Đỏ | $8\text{s} + 2\text{s}$ |
| **4** | Đỏ | Đỏ | Đỏ | $3,5\text{s}$ |
| **5** | Đỏ | Đỏ | **Xanh** | **$6\text{s}$** |
| **6** | Đỏ | Đỏ | Đỏ | $2\text{s}$ |

---

## 5. Danh Mục File & Cấu Trúc Patch Thay Đổi

1. **`shared/roadnet.js`** *(File mới)*: Đồ thị đường sá, vỉa hè, vị trí đèn, người đi bộ và phương tiện.
2. **`src/roadrender.js`** *(File mới)*: Module vẽ đường, vạch kẻ đường, quảng trường và cột đèn.
3. **`shared/colliders.js`, `shared/m3.js`**: Cập nhật lại khung va chạm, dời nhà, vườn hoa và tọa độ POI.
4. **`src/main.js`, `src/economy.js`, `src/net.js`, `index.html`**: Nối client vào mạng đường mới, sửa lỗi hiển thị và ánh xạ.
5. **`server/rooms/CityRoom.js`, `server/schema.js`**: Bot và NPC di chuyển theo vỉa hè, đồng bộ chu kỳ đèn.
6. **`supabase/migrations/006_lock_money.sql`** *(File mới)*: Vá 2 lỗ hổng bảo mật số dư tiền mặt:
   - Chặn quyền INSERT tự tạo hồ sơ tiền tùy ý ở `profiles_insert_own`.
   - Siết chặt xác thực `auth.uid()` trong các RPC `SECURITY DEFINER`.
7. **`test/roadnet-check.js`**: Bộ kiểm thử luật giao thông mới (thay thế `traffic-check.js`), kỳ vọng đạt `40 passed, 0 failed`.

---

## 6. Kế Hoạch Chuẩn Hóa Asset 2D & Tối Ưu

### Quy chuẩn vẽ lại Asset:
* **Góc nhìn**: Nhìn thẳng từ trên xuống (*strict top-down orthographic*), ánh sáng chiếu từ góc trên bên trái.
* **Định dạng**: PNG nền trong suốt, không lẫn viền tím, không dính nền đường hay cỏ trong file asset.
* **Tỷ lệ nhà**: Khớp khung va chạm:
  - Ngân hàng: $450 \times 330$
  - Bệnh viện: $570 \times 420$
  - Kho hàng: $630 \times 480$
* **Kích thước hiển thị vs Kích thước xuất file**:
  - Nhân vật: Hiển thị cao $40\text{ px}$ $\rightarrow$ Xuất file $128\text{ px}$ (bổ sung đủ 4 hướng đi).
  - Ô tô: Hiển thị $100 \times 49\text{ px}$ $\rightarrow$ Xuất file $200 \times 98\text{ px}$.
  - Xe máy: Hiển thị $32 \times 56\text{ px}$ $\rightarrow$ Xuất file $64 \times 112\text{ px}$.
  - Cây cối: Hiển thị $56\text{–}90\text{ px}$ $\rightarrow$ Xuất file $192\text{ px}$.
* **Dọn dẹp dung lượng**: Loại bỏ 32 file PNG không dùng trong `assets/` và `assets/v3/` (giải phóng ~11 MB), giữ lại `plaza-ground.png`.
