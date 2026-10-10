# Cập nhật và mang Pi sang mạng/máy tính khác

Website và Pi có thể được cập nhật tự động, nhưng hiện **chưa cấu hình tự động deploy production**. Hai workflow `verify.yml` chỉ chạy kiểm tra khi push vào `main` hoặc mở pull request; website có thêm artifact build để kiểm tra. Chúng không thay Pi, không khởi động gateway/tunnel và không dùng credentials production. Artifact CI không có cấu hình Firebase của máy thật: phải build lại với cấu hình đúng trước khi phát hành.

## Hệ thống hiện tại phụ thuộc vào đâu?

`Browser → https://sic4b.io.vn → Cloudflare Tunnel sic4b-pc trên PC Windows → gateway 127.0.0.1:8081 → SSH forward 127.0.0.1:18080 → Pi 127.0.0.1:8080`.

PC dùng source `F:\SICWEB`; release đang chạy được ghi trong `%LOCALAPPDATA%\SIC-media-current.txt`. File `apps\web\.env` của release đó chứa cấu hình website thật; `services\backend\.env.media` chứa cấu hình gateway. Service-account website ở `F:\SICWEB\secrets\firebase-site.json`, project Firebase Spark `sicccc-30fed`. Không đưa JSON, token Pi hoặc tunnel credentials vào Git, artifact CI hoặc biến `VITE_*`.

Pi hiện ở `192.168.0.208` trên LAN nhà. PC không cần nối USB với Pi: SSH dùng mạng. Người dùng mở website từ điện thoại, laptop hoặc PC bất kỳ; chỉ máy đang chạy gateway/tunnel cần kết nối tới Pi. PC đó ngủ/tắt hoặc mất SSH thì website hiện tại và dữ liệu mới từ Pi bị ảnh hưởng.

Users khuôn mặt, embeddings và lịch sử nằm trong SQLite/dữ liệu bền vững của Pi. Tài khoản đăng nhập website Firebase là phần riêng; đăng ký tài khoản website không tự tạo danh tính khuôn mặt trên Pi. Đổi Wi-Fi hay máy gateway không yêu cầu đăng ký lại khuôn mặt.

## Tự động cập nhật theo cách kiểm soát được

1. Dùng CI làm cổng kiểm tra trước merge. Web: test, TypeScript và build; gateway: kiểm tra API với Firebase/Pi giả lập. Pi: kiểm tra dashboard, storage và updater. Đây là kiểm tra phần mềm, chưa kiểm chứng camera, model thật hay mạng production.
2. Với website, deploy một commit đã qua kiểm tra thành release mới trên PC, giữ cấu hình riêng, kiểm tra localhost, đổi release đang chạy rồi kiểm tra domain. Giữ release trước để rollback. Không cập nhật trực tiếp thư mục đang phục vụ giữa chừng. Hướng dẫn gateway: [PC_SAME_DOMAIN_STREAM.md](PC_SAME_DOMAIN_STREAM.md); script cập nhật PC hiện có: `scripts/update_pc_dashboard.ps1`.
3. Muốn tự động cả bước deploy phải cài một agent/service trên PC (ví dụ self-hosted runner được bảo vệ hoặc Windows Task Scheduler), cấu hình quyền và credentials cục bộ, khóa để chỉ có một lần deploy, restart gateway và kiểm tra health; thất bại thì chạy lại release cũ. Chỉ deploy commit tin cậy; không cho pull request chạy trên runner giữ secrets. Chưa cài hoặc kích hoạt runner/lịch này trong thay đổi hiện tại.
4. Với Pi, trước mắt chỉ chọn updater cho dashboard/media theo nhu cầu, chạy preflight trước `--apply`, giữ backup và đối chiếu users/model trước/sau. **Không dùng `git pull main` hoặc tự chạy updater toàn bộ Pi**: Pi hiện dùng detector FP32 legacy và recognizer INT8, có thể khác identity model trên `main`.

Model phải qua bước riêng: manifest/checksum và fingerprint tương thích với embeddings đã lưu, thử nhận diện, kế hoạch migration hoặc đăng ký lại có chủ đích, backup dữ liệu và khả năng rollback. CI xanh không chứng minh model mới tương thích. Không cần Cloud Run hoặc nâng billing Firebase để thêm các kiểm tra này.

## Mang Pi sang Wi-Fi ngoài nhà

Pi còn nguồn, camera và Recog **ON** thì có thể tiếp tục ghi nhận vào SQLite khi offline; lịch sử/users không mất chỉ vì đổi mạng. Cần kiểm tra Recog sau restart thay vì giả định nó luôn bật. Website chỉ đọc được dữ liệu mới khi đường tới gateway/Pi hoạt động lại; lúc nối lại có thể đọc lịch sử đã lưu trên Pi. Việc cloud sync bắt kịp còn phụ thuộc cấu hình sync/outbox hiện có và kết nối tới Firebase.

Trên Pi, dùng màn hình/bàn phím hoặc kết nối quản trị còn hoạt động để kiểm tra:

```bash
hostname -I
ip route
# Chỉ dùng các lệnh nmcli nếu Pi đang dùng NetworkManager:
if command -v nmcli >/dev/null && systemctl is-active --quiet NetworkManager; then
  nmcli device status
  nmcli -f SSID,SIGNAL,SECURITY device wifi list
fi
```

Kết nối mạng mới bằng công cụ quản lý mạng đang dùng trên Pi; không dán mật khẩu Wi-Fi vào chat hoặc script lưu trên Git. Nếu dùng NetworkManager, có thể nhập tương tác bằng `nmtui`. Sau khi kết nối, chạy lại `hostname -I` để lấy IP thật. Địa chỉ `192.168.0.208` cũ thường không còn đúng.

PC ở nhà thường không truy cập được địa chỉ LAN riêng của Wi-Fi bên ngoài: thay IP trong SSH trên PC ở nhà chưa đủ. Cách thử đầu tiên là mang một laptop tin cậy theo và cho laptop/Pi vào cùng Wi-Fi hoặc hotspot, đảm bảo mạng không chặn liên lạc giữa các thiết bị.

## Thử laptop/PC mới trước trên cùng Wi-Fi

Trước khi mang đi, thử máy mới và Pi trên mạng nhà. Chuẩn bị Node, Python, OpenSSH và cloudflared; build release theo [PC_SAME_DOMAIN_STREAM.md](PC_SAME_DOMAIN_STREAM.md). Chuyển cấu hình web/gateway và credentials qua kênh an toàn chỉ tới máy tin cậy, sửa đường dẫn Windows cho máy mới; không copy qua repo công khai. Có thể giữ domain và Firebase project cũ.

Trong PowerShell trên máy sẽ chạy gateway, thay IP bằng giá trị vừa kiểm tra trên Pi. Nếu terminal SSH cũ đang giữ port `18080`, dừng bằng **Ctrl+C** trước khi bind lại:

```powershell
$piIp = '<IP LAN hiện tại của Pi>'
Test-NetConnection -ComputerName $piIp -Port 22
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18080:127.0.0.1:8080 "sic4b@$piIp"
```

Giữ terminal SSH mở. Trong terminal khác, kiểm tra forward trước, rồi chạy gateway từ release đã build/cấu hình đúng:

```powershell
Invoke-RestMethod http://127.0.0.1:18080/health
$release = '<đường dẫn release thật trên máy này>'
$env:GATEWAY_ENV_FILE = "$release\services\backend\.env.media"
Set-Location "$release\services\backend"
& "$release\.venv-media\Scripts\python.exe" -m uvicorn app.pi_gateway:create_app --factory --host 127.0.0.1 --port 8081
```

Terminal khác: `Invoke-RestMethod http://127.0.0.1:8081/health`. Kiểm tra thư mục static `WEB_STATIC_DIR`, gateway credentials và `PI_API_BASE_URL=http://127.0.0.1:18080` đúng trước khi phục vụ public.

**Dừng connector cloudflared `sic4b-pc` trên PC cũ trước khi chạy cùng tunnel trên máy mới**, kể cả service tự restart. Nếu cả hai connector cùng tunnel còn hoạt động, Cloudflare có thể phân phối requests tới cả backend cũ và mới, gây lỗi chập chờn. Dùng config tunnel đã chuyển an toàn và sửa đường dẫn credentials của máy mới:

```powershell
$tunnelConfig = '<đường dẫn cloudflared.yml đã kiểm tra trên máy mới>'
cloudflared tunnel --config $tunnelConfig run sic4b-pc
```

Không cần tạo lại tunnel hay đổi DNS khi dùng cùng tunnel ID. Kiểm tra domain, đăng nhập admin, trạng thái Pi, lịch sử, Unknown/Rejected, camera và một lượt điểm danh thật. Rollback: dừng connector mới trước, rồi chạy lại gateway/SSH/connector cũ trên mạng mà PC cũ truy cập được Pi.

## Camera và chạy độc lập 24/24

Cloudflare HTTPS chuyển website/API; video WebRTC có đường truyền riêng giữa browser và Pi. STUN có thể không vượt được NAT nghiêm ngặt, hotspot hoặc mạng chặn UDP. Website/API hoạt động không bảo đảm camera hoạt động; cần thử trên mạng đích, và có thể cần TURN được cấu hình/kiểm tra riêng.

Muốn mang **chỉ Pi**, không cần laptop gateway, hoặc chạy 24/24 khi PC tắt: lựa chọn tiếp theo là chuyển gateway+tunnel sang Pi (đo tải/nhiệt để không ảnh hưởng nhận diện), hoặc gateway trên VPS với VPN nối tới Pi. Những phương án này cần triển khai và kiểm tra riêng; chưa được thực hiện ở đây. Không mở trực tiếp API Pi ra Internet chỉ để khắc phục IP thay đổi.
