# sic4b.io.vn chạy trên PC với Firebase Spark

Kiến trúc: Cloudflare named Tunnel → PC gateway `127.0.0.1:8081` → SPA và `/api/pi/*`; gateway → SSH forward `127.0.0.1:18080` → Pi `127.0.0.1:8080`. API đầy đủ của PC ở `127.0.0.1:8000` được proxy qua `/attendance-api/*`. Firebase Spark tiếp tục phục vụ Auth/Firestore/RTDB. Không cần Cloud Run, nâng billing hoặc thêm domain media. PC, Pi và mạng phải bật liên tục. Đây là hướng dẫn triển khai; code đã kiểm thử không chứng minh camera thật đã kết nối.

## 1. Chuẩn bị bản main trên PC

PowerShell; giữ nguyên source và `.env` cũ bằng worktree mới:

```powershell
Set-Location F:\SICWEB
git fetch origin main
$release = "F:\SICWEB-releases\$(Get-Date -Format yyyyMMdd-HHmmss)"
git worktree add --detach $release origin/main
Copy-Item F:\SICWEB\apps\web\.env "$release\apps\web\.env"
notepad "$release\apps\web\.env"
```

Giữ các biến Firebase Auth của project `sicccc-30fed`; sửa/thêm mỗi biến một lần:

```dotenv
VITE_API_BASE_URL=https://sic4b.io.vn/attendance-api
VITE_PI_API_BASE_URL=https://sic4b.io.vn
VITE_FIREBASE_DATABASE_URL=<URL RTDB thật của project sicccc-30fed>
```

Không đặt token Pi hoặc service-account JSON vào biến `VITE_*`. Trong Firebase Console của `sicccc-30fed`, tạo Realtime Database ở chế độ locked nếu chưa có, lấy URL thực tế. Xem `firebase/database.webrtc.rules.template.json`: chỉ ghép nhánh `webrtc` vào rules hiện có, kiểm tra không có quyền đọc/ghi rộng ở ancestor. Không deploy cả template đè dữ liệu/rules đang dùng. Browser chỉ đọc session của admin sở hữu session; mọi ghi signaling đi qua gateway/Pi Admin SDK. Tài khoản đăng nhập cần claim `admin: true` hiện có, không chỉ một trường role trong Firestore.

```powershell
Set-Location "$release\apps\web"
npm ci
npm run build
Set-Location $release
py -3 -m venv .venv-media
& .\.venv-media\Scripts\python.exe -m pip install -r services/backend/requirements-media.txt
notepad "$release\services\backend\.env.media"
```

Nội dung `.env.media` (thay các chỗ `<...>` bằng cấu hình thật trên máy):

```dotenv
FIREBASE_PROJECT_ID=sicccc-30fed
FIREBASE_SERVICE_ACCOUNT=F:/SICWEB/secrets/firebase-site.json
FIREBASE_DATABASE_URL=<cùng URL RTDB trong web>
PI_API_BASE_URL=http://127.0.0.1:18080
PI_CONTROL_MODE=legacy-loopback
PI_API_TOKEN=<ADMIN_SHARED_TOKEN hiện đang dùng trên Pi>
PI_ID=pi-classroom-01
PI_CAMERA_IDS=icspring,jieli,sonix
WEB_STATIC_DIR=<đường dẫn release dùng dấu / hoặc \\>/apps/web/web-build
ATTENDANCE_API_BASE_URL=http://127.0.0.1:8000
CORS_ORIGINS=https://sic4b.io.vn,https://sicccc-30fed.web.app,https://sicccc-30fed.firebaseapp.com
```

JSON phải thuộc `sicccc-30fed`; gateway từ chối project không khớp. Dùng file riêng với quyền NTFS chỉ cho tài khoản chạy dịch vụ; không commit file/JSON. `PI_API_TOKEN` chỉ phù hợp khi Pi đang dùng auth `shared_token`: lấy token hiện có cục bộ, không đổi auth mode/token để ép chạy. Nếu Pi dùng Firebase auth của project khác, phải thống nhất cách xác thực trước khi gateway đọc attendance; token website không tự dùng được cho project khác.

## 2. Chỉ cập nhật media/log trên Pi, giữ model và registered users

Chạy trên Pi. Không `git pull`, không chạy updater toàn bộ khi model fingerprint chưa tương thích:

```bash
cd /home/sic4b/Smart-Attendance-Pi4-multiple-cams
git fetch origin main
git show FETCH_HEAD:src/pi4_attendance/webrtc.py > /tmp/sic-webrtc.py
git show FETCH_HEAD:scripts/update_media_only.py > /tmp/sic-update-media.py
curl --fail http://127.0.0.1:8080/health > /tmp/sic-health-before-media.json
python3 /tmp/sic-update-media.py --repo "$PWD" --source /tmp/sic-webrtc.py
python3 /tmp/sic-update-media.py --repo "$PWD" --source /tmp/sic-webrtc.py --apply
mkdir -p /home/sic4b/.config/sic-media
chmod 700 /home/sic4b/.config/sic-media
```

Updater chỉ thay `webrtc.py` và thêm route log đọc-only vào `api.py` nếu thiếu; backup có đường dẫn trong kết quả JSON ở `/home/sic4b/sic-media-backups/`. Nó không thay engine, model, embeddings, users hoặc attendance. Preflight kiểm tra dependency media hiện có bằng venv của Pi.

PowerShell: copy service-account của project website tới Pi (đường dẫn PC phải đúng file thật):

```powershell
scp F:\SICWEB\secrets\firebase-site.json sic4b@192.168.0.208:/home/sic4b/.config/sic-media/firebase-site.json
```

Trên Pi:

```bash
chmod 600 /home/sic4b/.config/sic-media/firebase-site.json
sudo sh -c 'if [ ! -e /etc/sic-webrtc.env ]; then install -m 600 /dev/null /etc/sic-webrtc.env; fi'
sudoedit /etc/sic-webrtc.env
```

Nếu file đã tồn tại, dùng `sudoedit` giữ cấu hình cũ, **không** chạy lại `install /dev/null`. Nội dung:

```dotenv
WEBRTC_FIREBASE_PROJECT_ID=sicccc-30fed
WEBRTC_FIREBASE_DATABASE_URL=<cùng URL RTDB>
WEBRTC_FIREBASE_SERVICE_ACCOUNT=/home/sic4b/.config/sic-media/firebase-site.json
```

Các biến `FIREBASE_*` cũ của attendance được giữ. Tạo drop-in riêng (nếu đã có, lưu bản cũ trước khi sửa):

```bash
sudo mkdir -p /etc/systemd/system/sic-pi4-attendance.service.d
sudoedit /etc/systemd/system/sic-pi4-attendance.service.d/90-media-project.conf
```

```ini
[Service]
EnvironmentFile=/etc/sic-webrtc.env
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart sic-pi4-attendance
systemctl status sic-pi4-attendance --no-pager
curl --fail http://127.0.0.1:8080/health > /tmp/sic-health-after-media.json
journalctl -u sic-pi4-attendance -n 80 --no-pager
```

So sánh model version và số registered users trước/sau; không được thay đổi. Nếu lỗi: dừng service, copy từng `webrtc.py`/`api.py` có trong backup JSON về đúng đường dẫn, khôi phục drop-in cũ (hoặc bỏ đúng drop-in vừa tạo), daemon-reload rồi restart. Không reset cả repo hay xóa data/model.

## 3. Chạy ba tiến trình trên PC trước khi đổi DNS

Terminal PowerShell thứ nhất: SSH forward, giữ mở:

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18080:127.0.0.1:8080 sic4b@192.168.0.208
```

Terminal thứ hai (đặt `$release` đúng thư mục tạo ở bước 1):

```powershell
$release = '<đường dẫn release>'
Set-Location "$release\services\backend"
$env:GATEWAY_ENV_FILE = "$release\services\backend\.env.media"
& "$release\.venv-media\Scripts\python.exe" -m uvicorn app.pi_gateway:app --host 127.0.0.1 --port 8081
```

Terminal thứ ba:

```powershell
Invoke-RestMethod http://127.0.0.1:8081/health
cloudflared tunnel list
cloudflared tunnel login
cloudflared tunnel create sic-attendance-pc
```

Chỉ tạo tunnel nếu tên chưa tồn tại. Dùng UUID và credentials JSON do lệnh trả về, tạo file config riêng, không ghi đè cấu hình tunnel khác:

```yaml
tunnel: <UUID>
credentials-file: F:/SICWEB/secrets/<UUID>.json
ingress:
  - hostname: sic4b.io.vn
    service: http://127.0.0.1:8081
  - service: http_status:404
```

```powershell
cloudflared tunnel --config F:\SICWEB\secrets\sic-pc-tunnel.yml run sic-attendance-pc
```

Cuối cùng, lưu lại DNS Firebase hiện tại trong Cloudflare để rollback, rồi chuyển **đúng** hostname `sic4b.io.vn` từ các A/AAAA/CNAME Firebase cũ sang tunnel:

```powershell
cloudflared tunnel route dns --overwrite-dns sic-attendance-pc sic4b.io.vn
```

Nếu có nhiều record A/AAAA cùng tên, kiểm tra và thay chúng trong Cloudflare Dashboard để chỉ còn CNAME tunnel được proxy. Không đổi record mail/TXT hoặc hostname khác. Rollback: khôi phục các record đã lưu. Firebase Hosting default domains vẫn tồn tại; site custom domain giờ được PC phục vụ.

## 4. Kiểm tra và chạy lâu dài

Mở `https://sic4b.io.vn`, đăng nhập admin → **Điểm danh Pi** → mở camera rồi bật Recog. Kiểm tra Unknown/Rejected có lý do và model version; Accepted attendance hiển thị từ SQLite Pi, có trạng thái sync và CSV. Raw recognition observations không phải mỗi dòng một attendance: cooldown/duplicate suppression vẫn áp dụng. API PC tắt sẽ trả 503 ở `/attendance-api/*`; tab Pi vẫn hoạt động độc lập nếu gateway/Pi/RTDB đang chạy.

WebRTC video đi trực tiếp giữa browser và Pi; Cloudflare Tunnel/SSH chỉ chuyển signaling/control/API, không relay RTP. Thử trước trên cùng LAN. STUN không đảm bảo truy cập từ mọi mạng; mạng NAT khó/UDP bị chặn cần TURN có xác thực, chưa cấu hình trong bản này. Không mở công khai port8080/18080/8081 hay RTDB write để chữa lỗi.

Để 24/24: tắt sleep PC; dùng SSH key với quyền giới hạn cho forward thay vì lưu password trong script; chạy SSH/gateway/cloudflared bằng Windows service hoặc Scheduled Tasks riêng với tự restart/log, chỉ sau khi ba terminal chạy ổn. Task chỉ chạy lúc login không đảm bảo phục hồi trước login sau reboot. Giữ đường dẫn release cố định trong task và dùng đúng user có quyền đọc credentials. Không chạy đồng thời nhiều gateway hoặc nhiều process trên cùng port. API đầy đủ có thể thêm service riêng sau kiểm thử Pi; gateway không nạp model AI.
