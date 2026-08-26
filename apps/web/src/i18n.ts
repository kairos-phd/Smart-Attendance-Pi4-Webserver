export type Language = 'en' | 'vi';

const en = {
  locale: 'en-US',
  nav: { overview: 'Overview', attendance: 'Attendance', users: 'Users', unknown: 'Unknown', devices: 'Devices', admin: 'Administration' },
  common: {
    user: 'User', online: 'Online', offline: 'Offline', checking: 'Checking', active: 'Active', inactive: 'Inactive',
    close: 'Close', refresh: 'Refresh', settings: 'Settings', loading: 'Loading…', demo: 'Demo', noImage: 'No image', viewImage: 'View image',
    waitingTimestamp: 'Waiting for timestamp', signOut: 'Sign out', camera: 'Camera', time: 'Time', status: 'Status', image: 'Image',
    administrator: 'Admin', viewer: 'Viewer', notAvailable: 'Not available',
  },
  settings: {
    eyebrow: 'PREFERENCES', title: 'Dashboard settings', appearance: 'Appearance', appearanceHint: 'Choose the dashboard color theme',
    colorTheme: 'Color theme', dark: 'Dark', light: 'Light', clock24: '24-hour clock', clock24Hint: 'Display time using the 24-hour format',
    seconds: 'Show seconds', secondsHint: 'Include seconds in the live clock', language: 'Language', languageHint: 'Choose the interface language',
    demo: 'Demo data', demoHint: 'Show realistic sample records while the hardware is not connected', signOut: 'Sign out of this account',
    saved: 'These preferences are saved in this browser.', english: 'English', vietnamese: 'Tiếng Việt',
  },
  auth: {
    system: 'SIC · ATTENDANCE SYSTEM', access: 'Account access', signIn: 'Sign in', signUp: 'Sign up', welcomeBack: 'Welcome back.',
    signInHint: 'Sign in with your account.', email: 'Email', password: 'Password', signingIn: 'Signing in…', forgot: 'Forgot password?',
    welcome: 'Welcome.', signUpHint: 'Create an account for the SmartAttend dashboard.', username: 'Username', dob: 'Date of birth',
    confirmPassword: 'Confirm password', create: 'Create account', creating: 'Creating account…', signUpHelp: 'We will email you a secure verification link. Usernames are unique and cannot be reused.',
    resetTitle: 'Reset password', resetHint: 'Enter your account email, and we will send you a password reset link.', sendReset: 'Send reset link',
    sendingReset: 'Sending reset email…', back: 'Back to sign in', openSettings: 'Open settings', usernameInvalid: 'The username must contain 3–24 letters, numbers, or underscores.',
    chooseDob: 'Choose your date of birth.', shortPassword: 'The password must contain at least 6 characters.', mismatch: 'The passwords do not match.',
    created: 'Account created. Open the verification link sent to your email, then sign in.', usernameTaken: 'That username is already taken. Choose another username.',
    emailUsed: 'An account already uses this email.', firestoreMissing: 'Account registration is unavailable because the Firestore database has not been created. Ask the project administrator to create the (default) database, then try again.',
    createFailed: 'Unable to create the account.', accountMissing: 'Your account is not registered.', wrongPassword: 'The password is incorrect. Please try again.',
    invalidCredential: 'The account is not registered, or the password is incorrect.', signInFailed: 'Unable to sign in.', resetSent: 'We sent a password reset link. Check your inbox and spam folder.',
    resetFailed: 'Unable to send the password reset email.',
  },
  dashboard: {
    subtitle: 'AI attendance system', openNav: 'Open navigation', closeNav: 'Close navigation',
    camerasOnline: 'Cameras online', demoBanner: 'Demo data is enabled. These records are examples and are not real attendance data.',
  },
  overview: {
    recognized: 'Recognized today', recognizedHint: 'Attendance events recorded today', unknown: 'Unknown events', unknownHint: 'Latest detection events',
    activeUsers: 'Active users', activeUsersHint: 'Registered face profiles', cameraHealth: 'Camera health', cameraHealthHint: 'Online camera sources',
    todayTitle: 'Today’s attendance', todayHint: 'People most recently recognized across both cameras',
  },
  attendance: {
    date: 'Date', search: 'Search', searchPlaceholder: 'Name, user ID, or camera', export: 'Export CSV', today: 'Today', yesterday: 'Yesterday',
    week: 'This week', custom: 'Custom date', person: 'Person', recognized: 'Recognized', empty: 'No attendance events were found for this period.',
    showing: (count: number) => `${count} ${count === 1 ? 'record' : 'records'}`, exported: 'Attendance CSV exported.',
  },
  users: {
    register: 'Register a user', registerHint: 'Upload 3–8 clear photos of the same person: front-facing, slightly left, and slightly right. Each photo needs one clear foreground person; small background faces are ignored.',
    demoDisabled: 'Disable demo data to manage real user profiles.', fullName: 'Full name', userId: 'User ID', facePhoto: 'Face photo', choosePhoto: 'Choose a face photo', facePhotos: 'Face samples', choosePhotos: 'Choose 3–8 face photos',
    fileHint: 'JPG, PNG, or WebP · one clear foreground person per photo', readyUpload: (size: string) => `${size} MB · Ready to upload`, photosSelected: (count: number) => `${count} photos selected`, samplesReady: (count: number, size: string) => `${count}/8 samples · ${size} MB total`, replace: 'Replace', browse: 'Browse',
    removePhoto: 'Remove the selected photo', removePhotos: 'Remove selected photos', photoProblem: (index: string, filename: string) => `Photo ${index}${filename ? ` (${filename})` : ''}`, creating: 'Creating profile…', create: 'Create profile', serviceOffline: 'Service offline', registered: 'Registered users', samples: (count: number) => `${count} face ${count === 1 ? 'sample' : 'samples'}`,
    noId: 'No user ID', deactivate: 'Deactivate', deactivateTitle: 'Deactivate user', deactivateConfirm: 'Deactivate this face profile? Historical attendance records will be retained.',
    offlineTitle: 'AI server is offline', unavailableProfiles: 'User profiles are unavailable while the AI server is offline.', checkingProfiles: 'Checking the AI server…',
    empty: 'No user profiles have been registered.', chooseClearPhoto: 'Choose a clear enrollment photo.', enrolled: 'User profile created successfully.', deactivated: 'User profile deactivated.',
    refreshed: 'User profiles refreshed.', apiOffline: 'The AI server is offline. Start the AI service and check its connection.', enrollmentFailed: 'Enrollment failed.', updateFailed: 'Update failed.',
    adminRequired: 'Administrator access is required.', photoFormat: 'The enrollment photo must be a JPEG, PNG, or WebP file.', photoLarge: 'The enrollment photo must be no larger than 8 MB.', photoDecode: 'The enrollment photo could not be read.', noFace: 'No face was detected. Use a clear, well-lit photo.', lowConfidence: 'Face detection confidence is too low. Use a clearer, well-lit photo.', sampleCountError: 'Choose between 3 and 8 clear photos of the same person.', photoBlurry: 'One photo is too blurry. Use a sharper photo.', faceSmall: 'The face is too small in one photo. Move closer to the camera.', photoDark: 'One photo is too dark. Improve the lighting.', photoBright: 'One photo is overexposed. Reduce the lighting.', inconsistentPhotos: 'The photos do not appear to show the same person. Review the selected samples.', idExists: 'A user with this ID already exists.',
  },
  unknown: {
    title: 'Unknown-person events', hint: 'Unregistered faces remain unknown. The system never displays a guessed name.', bestScore: 'Nearest profile score', scoreHint: 'Diagnostic only; no identity assigned', faceCrop: 'Unknown face crop', demoFace: 'Demonstration unknown-person image', laptopOnly: 'Available on the laptop only', actions: 'Review actions', pending: 'Pending', reviewed: 'Kept as unknown', dismissed: 'Dismissed', markReviewed: 'Mark reviewed', keepUnknown: 'Keep unknown', dismiss: 'Dismiss', deleteImage: 'Delete image', deleteConfirm: 'Permanently delete this local face image? The event metadata will remain.', reviewedToast: 'Event retained as an unknown person.', dismissedToast: 'Unknown event dismissed.', deletedToast: 'Local face image deleted.', reviewFailed: 'Unable to update the review status.', deleteFailed: 'Unable to delete the local image.', empty: 'No unknown-person events were found.',
  },
  admin: {
    title: 'Account administration', hint: 'Manage authenticated dashboard accounts and view minimal recent activity. Passwords and page contents are never collected.', onlineNow: 'Online now', onlineHint: 'Active within the last 45 seconds', totalAccounts: 'Total accounts', totalHint: 'Firebase Authentication accounts', admins: 'Administrators', adminsHint: 'Active privileged accounts', disabled: 'Disabled', disabledHint: 'Accounts blocked from signing in', account: 'Account', role: 'Role', presence: 'Presence', currentPage: 'Current page', lastSeen: 'Last active', actions: 'Account actions', verified: 'Verified email', unverified: 'Unverified email', currentAccount: 'Current account', makeAdmin: 'Make admin', makeViewer: 'Make viewer', enable: 'Enable', disable: 'Disable', empty: 'No dashboard accounts were found.', apiRequired: 'Start the AI server to load and manage accounts.', loadFailed: 'Unable to load dashboard accounts.', updateFailed: 'Unable to update this account.', updated: 'Account permissions updated.', disableConfirm: (name: string) => `Disable ${name}? Their sessions will be revoked.`, promoteConfirm: (name: string) => `Grant administrator access to ${name}?`, demoteConfirm: (name: string) => `Remove administrator access from ${name}?`,
  },
  devices: {
    realtime: 'Live status', piMissing: 'Pi not reported', heartbeat: 'Last heartbeat', lastError: 'Last error', empty: 'No cameras have reported yet. Start the Pi camera service.',
  },
  datePicker: { select: 'Select a date', choose: 'Choose', previous: 'Previous month', next: 'Next month', month: 'Month', year: 'Year', clear: 'Clear', today: 'Today' },
  legal: { privacy: 'Privacy policy' },
  errors: { indexBuilding: 'The attendance index is being prepared. Refresh this page in a few minutes.', permission: 'Your account does not have permission to read this data.', data: 'Unable to load dashboard data.' },
  toast: { language: 'Language updated.', theme: 'Theme updated.', demoOn: 'Demo data enabled.', demoOff: 'Demo data disabled.' },
};

const vi: typeof en = {
  locale: 'vi-VN',
  nav: { overview: 'Tổng quan', attendance: 'Chấm công', users: 'Người dùng', unknown: 'Người lạ', devices: 'Thiết bị', admin: 'Quản trị' },
  common: {
    user: 'Người dùng', online: 'Trực tuyến', offline: 'Ngoại tuyến', checking: 'Đang kiểm tra', active: 'Đang hoạt động', inactive: 'Đã vô hiệu hóa',
    close: 'Đóng', refresh: 'Làm mới', settings: 'Cài đặt', loading: 'Đang tải…', demo: 'Minh họa', noImage: 'Không có ảnh', viewImage: 'Xem ảnh',
    waitingTimestamp: 'Đang chờ thời gian ghi nhận', signOut: 'Đăng xuất', camera: 'Camera', time: 'Thời gian', status: 'Trạng thái', image: 'Hình ảnh',
    administrator: 'Quản trị viên', viewer: 'Người xem', notAvailable: 'Không có dữ liệu',
  },
  settings: {
    eyebrow: 'TÙY CHỌN', title: 'Cài đặt bảng điều khiển', appearance: 'Giao diện', appearanceHint: 'Chọn giao diện màu cho bảng điều khiển',
    colorTheme: 'Giao diện màu', dark: 'Tối', light: 'Sáng', clock24: 'Đồng hồ 24 giờ', clock24Hint: 'Hiển thị thời gian theo định dạng 24 giờ',
    seconds: 'Hiển thị giây', secondsHint: 'Hiển thị giây trên đồng hồ trực tiếp', language: 'Ngôn ngữ', languageHint: 'Chọn ngôn ngữ cho giao diện',
    demo: 'Dữ liệu minh họa', demoHint: 'Hiển thị dữ liệu mẫu thực tế khi phần cứng chưa được kết nối', signOut: 'Đăng xuất khỏi tài khoản này',
    saved: 'Các tùy chọn này được lưu trong trình duyệt.', english: 'English', vietnamese: 'Tiếng Việt',
  },
  auth: {
    system: 'SIC · HỆ THỐNG CHẤM CÔNG', access: 'Truy cập tài khoản', signIn: 'Đăng nhập', signUp: 'Đăng ký', welcomeBack: 'Chào mừng bạn quay lại.',
    signInHint: 'Đăng nhập bằng tài khoản của bạn.', email: 'Email', password: 'Mật khẩu', signingIn: 'Đang đăng nhập…', forgot: 'Quên mật khẩu?',
    welcome: 'Chào mừng bạn.', signUpHint: 'Tạo tài khoản để sử dụng bảng điều khiển SmartAttend.', username: 'Tên đăng nhập', dob: 'Ngày sinh',
    confirmPassword: 'Xác nhận mật khẩu', create: 'Tạo tài khoản', creating: 'Đang tạo tài khoản…', signUpHelp: 'Chúng tôi sẽ gửi liên kết xác minh bảo mật qua email. Tên đăng nhập là duy nhất và không thể sử dụng lại.',
    resetTitle: 'Đặt lại mật khẩu', resetHint: 'Nhập email của tài khoản; chúng tôi sẽ gửi cho bạn liên kết đặt lại mật khẩu.', sendReset: 'Gửi liên kết đặt lại',
    sendingReset: 'Đang gửi email…', back: 'Quay lại đăng nhập', openSettings: 'Mở cài đặt', usernameInvalid: 'Tên đăng nhập phải gồm 3–24 chữ cái, chữ số hoặc dấu gạch dưới.',
    chooseDob: 'Vui lòng chọn ngày sinh.', shortPassword: 'Mật khẩu phải có ít nhất 6 ký tự.', mismatch: 'Mật khẩu xác nhận không khớp.',
    created: 'Đã tạo tài khoản. Hãy mở liên kết xác minh được gửi qua email, sau đó đăng nhập.', usernameTaken: 'Tên đăng nhập này đã được sử dụng. Vui lòng chọn tên khác.',
    emailUsed: 'Email này đã được dùng cho một tài khoản khác.', firestoreMissing: 'Chưa thể đăng ký tài khoản vì cơ sở dữ liệu Firestore chưa được tạo. Hãy yêu cầu quản trị viên dự án tạo cơ sở dữ liệu (default), sau đó thử lại.',
    createFailed: 'Không thể tạo tài khoản.', accountMissing: 'Tài khoản này chưa được đăng ký.', wrongPassword: 'Mật khẩu không đúng. Vui lòng thử lại.',
    invalidCredential: 'Tài khoản chưa được đăng ký hoặc mật khẩu không đúng.', signInFailed: 'Không thể đăng nhập.', resetSent: 'Đã gửi liên kết đặt lại mật khẩu. Hãy kiểm tra hộp thư đến và thư rác.',
    resetFailed: 'Không thể gửi email đặt lại mật khẩu.',
  },
  dashboard: {
    subtitle: 'Hệ thống chấm công bằng AI', openNav: 'Mở trình đơn điều hướng', closeNav: 'Đóng trình đơn điều hướng',
    camerasOnline: 'Camera đang hoạt động', demoBanner: 'Dữ liệu minh họa đang được bật. Đây chỉ là dữ liệu mẫu, không phải dữ liệu chấm công thật.',
  },
  overview: {
    recognized: 'Đã nhận diện hôm nay', recognizedHint: 'Các lượt chấm công được ghi nhận hôm nay', unknown: 'Sự kiện người lạ', unknownHint: 'Các sự kiện phát hiện gần đây',
    activeUsers: 'Người dùng đang hoạt động', activeUsersHint: 'Hồ sơ khuôn mặt đã đăng ký', cameraHealth: 'Tình trạng camera', cameraHealthHint: 'Nguồn camera đang trực tuyến',
    todayTitle: 'Lượt chấm công hôm nay', todayHint: 'Những người được nhận diện gần đây nhất từ cả hai camera',
  },
  attendance: {
    date: 'Ngày', search: 'Tìm kiếm', searchPlaceholder: 'Tên, mã người dùng hoặc camera', export: 'Xuất CSV', today: 'Hôm nay', yesterday: 'Hôm qua',
    week: 'Tuần này', custom: 'Ngày tùy chọn', person: 'Người dùng', recognized: 'Đã nhận diện', empty: 'Không tìm thấy lượt chấm công nào trong khoảng thời gian này.',
    showing: (count: number) => `${count} bản ghi`, exported: 'Đã xuất dữ liệu chấm công ra tệp CSV.',
  },
  users: {
    register: 'Đăng ký người dùng', registerHint: 'Tải lên 3–8 ảnh rõ nét của cùng một người: nhìn thẳng, hơi quay trái và hơi quay phải. Mỗi ảnh cần có một người rõ nét ở tiền cảnh; các khuôn mặt nhỏ phía sau sẽ được bỏ qua.',
    demoDisabled: 'Hãy tắt dữ liệu minh họa để quản lý hồ sơ thật.', fullName: 'Họ và tên', userId: 'Mã người dùng', facePhoto: 'Ảnh khuôn mặt', choosePhoto: 'Chọn ảnh khuôn mặt', facePhotos: 'Mẫu khuôn mặt', choosePhotos: 'Chọn từ 3 đến 8 ảnh khuôn mặt',
    fileHint: 'JPG, PNG hoặc WebP · mỗi ảnh có một người rõ nét ở tiền cảnh', readyUpload: (size: string) => `${size} MB · Sẵn sàng tải lên`, photosSelected: (count: number) => `Đã chọn ${count} ảnh`, samplesReady: (count: number, size: string) => `${count}/8 mẫu · Tổng dung lượng ${size} MB`, replace: 'Thay ảnh', browse: 'Chọn tệp',
    removePhoto: 'Xóa ảnh đã chọn', removePhotos: 'Xóa các ảnh đã chọn', photoProblem: (index: string, filename: string) => `Ảnh ${index}${filename ? ` (${filename})` : ''}`, creating: 'Đang tạo hồ sơ…', create: 'Tạo hồ sơ', serviceOffline: 'Dịch vụ ngoại tuyến', registered: 'Người dùng đã đăng ký', samples: (count: number) => `${count} mẫu khuôn mặt`,
    noId: 'Chưa có mã người dùng', deactivate: 'Vô hiệu hóa', deactivateTitle: 'Vô hiệu hóa người dùng', deactivateConfirm: 'Vô hiệu hóa hồ sơ khuôn mặt này? Dữ liệu chấm công trước đây vẫn được giữ lại.',
    offlineTitle: 'Máy chủ AI đang ngoại tuyến', unavailableProfiles: 'Không thể tải hồ sơ người dùng khi máy chủ AI đang ngoại tuyến.', checkingProfiles: 'Đang kiểm tra máy chủ AI…',
    empty: 'Chưa có hồ sơ người dùng nào được đăng ký.', chooseClearPhoto: 'Vui lòng chọn ảnh khuôn mặt rõ nét.', enrolled: 'Đã tạo hồ sơ người dùng.', deactivated: 'Đã vô hiệu hóa hồ sơ người dùng.',
    refreshed: 'Đã làm mới danh sách người dùng.', apiOffline: 'Máy chủ AI đang ngoại tuyến. Hãy khởi động dịch vụ AI và kiểm tra kết nối.', enrollmentFailed: 'Không thể đăng ký người dùng.', updateFailed: 'Không thể cập nhật người dùng.',
    adminRequired: 'Cần có quyền quản trị viên.', photoFormat: 'Ảnh đăng ký phải là tệp JPEG, PNG hoặc WebP.', photoLarge: 'Dung lượng ảnh đăng ký không được vượt quá 8 MB.', photoDecode: 'Không thể đọc ảnh đăng ký.', noFace: 'Không phát hiện được khuôn mặt. Hãy sử dụng ảnh rõ nét và đủ sáng.', lowConfidence: 'Độ tin cậy khi phát hiện khuôn mặt quá thấp. Hãy sử dụng ảnh rõ nét và đủ sáng hơn.', sampleCountError: 'Hãy chọn từ 3 đến 8 ảnh rõ nét của cùng một người.', photoBlurry: 'Có ảnh bị nhòe. Hãy sử dụng ảnh rõ nét hơn.', faceSmall: 'Khuôn mặt trong một ảnh quá nhỏ. Hãy đưa camera lại gần hơn.', photoDark: 'Có ảnh quá tối. Hãy cải thiện ánh sáng.', photoBright: 'Có ảnh bị dư sáng. Hãy giảm ánh sáng.', inconsistentPhotos: 'Các ảnh có vẻ không phải của cùng một người. Hãy kiểm tra lại các mẫu đã chọn.', idExists: 'Đã tồn tại người dùng có mã này.',
  },
  unknown: {
    title: 'Sự kiện phát hiện người lạ', hint: 'Khuôn mặt chưa đăng ký sẽ luôn được giữ ở trạng thái người lạ. Hệ thống không hiển thị tên phỏng đoán.', bestScore: 'Điểm hồ sơ gần nhất', scoreHint: 'Chỉ dùng để tham khảo; không xác định danh tính', faceCrop: 'Ảnh khuôn mặt người lạ', demoFace: 'Ảnh minh họa người lạ', laptopOnly: 'Chỉ xem được trên máy tính xử lý', actions: 'Thao tác kiểm duyệt', pending: 'Chờ kiểm duyệt', reviewed: 'Giữ là người lạ', dismissed: 'Đã bỏ qua', markReviewed: 'Đánh dấu đã xem', keepUnknown: 'Giữ là người lạ', dismiss: 'Bỏ qua', deleteImage: 'Xóa ảnh', deleteConfirm: 'Xóa vĩnh viễn ảnh khuôn mặt được lưu trên máy tính? Thông tin sự kiện vẫn được giữ lại.', reviewedToast: 'Đã giữ sự kiện ở trạng thái người lạ.', dismissedToast: 'Đã bỏ qua sự kiện người lạ.', deletedToast: 'Đã xóa ảnh khuôn mặt trên máy tính.', reviewFailed: 'Không thể cập nhật trạng thái kiểm duyệt.', deleteFailed: 'Không thể xóa ảnh trên máy tính.', empty: 'Không tìm thấy sự kiện người lạ nào.',
  },
  admin: {
    title: 'Quản trị tài khoản', hint: 'Quản lý các tài khoản đã đăng nhập và xem hoạt động tối thiểu gần đây. Hệ thống không thu thập mật khẩu hoặc nội dung trang.', onlineNow: 'Đang trực tuyến', onlineHint: 'Hoạt động trong 45 giây gần nhất', totalAccounts: 'Tổng tài khoản', totalHint: 'Tài khoản Firebase Authentication', admins: 'Quản trị viên', adminsHint: 'Tài khoản đặc quyền đang hoạt động', disabled: 'Đã vô hiệu hóa', disabledHint: 'Tài khoản bị chặn đăng nhập', account: 'Tài khoản', role: 'Vai trò', presence: 'Trạng thái', currentPage: 'Trang hiện tại', lastSeen: 'Hoạt động gần nhất', actions: 'Thao tác tài khoản', verified: 'Email đã xác minh', unverified: 'Email chưa xác minh', currentAccount: 'Tài khoản hiện tại', makeAdmin: 'Cấp quyền quản trị', makeViewer: 'Chuyển thành người xem', enable: 'Kích hoạt', disable: 'Vô hiệu hóa', empty: 'Không tìm thấy tài khoản bảng điều khiển.', apiRequired: 'Hãy khởi động máy chủ AI để tải và quản lý tài khoản.', loadFailed: 'Không thể tải danh sách tài khoản.', updateFailed: 'Không thể cập nhật tài khoản này.', updated: 'Đã cập nhật quyền của tài khoản.', disableConfirm: (name: string) => `Vô hiệu hóa ${name}? Các phiên đăng nhập của tài khoản sẽ bị thu hồi.`, promoteConfirm: (name: string) => `Cấp quyền quản trị viên cho ${name}?`, demoteConfirm: (name: string) => `Thu hồi quyền quản trị viên của ${name}?`,
  },
  devices: {
    realtime: 'Trạng thái trực tiếp', piMissing: 'Pi chưa gửi thông tin', heartbeat: 'Lần phản hồi gần nhất', lastError: 'Lỗi gần nhất', empty: 'Chưa có camera nào gửi trạng thái. Hãy khởi động dịch vụ camera trên Pi.',
  },
  datePicker: { select: 'Chọn ngày', choose: 'Chọn', previous: 'Tháng trước', next: 'Tháng sau', month: 'Tháng', year: 'Năm', clear: 'Xóa', today: 'Hôm nay' },
  legal: { privacy: 'Chính sách quyền riêng tư' },
  errors: { indexBuilding: 'Chỉ mục chấm công đang được chuẩn bị. Hãy làm mới trang sau vài phút.', permission: 'Tài khoản của bạn không có quyền đọc dữ liệu này.', data: 'Không thể tải dữ liệu cho bảng điều khiển.' },
  toast: { language: 'Đã cập nhật ngôn ngữ.', theme: 'Đã cập nhật giao diện.', demoOn: 'Đã bật dữ liệu minh họa.', demoOff: 'Đã tắt dữ liệu minh họa.' },
};

export type Copy = typeof en;
export const translations: Record<Language, Copy> = { en, vi };
