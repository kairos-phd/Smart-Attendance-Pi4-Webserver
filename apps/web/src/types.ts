export type FirestoreTimestampLike = { toDate: () => Date };

export type Attendance = {
  id: string;
  attendance_id: string;
  user_id: string;
  name: string;
  camera_id: string;
  timestamp?: FirestoreTimestampLike;
  date: string;
  confidence: number;
  status: 'recognized';
  raspberry_pi_id: string;
  created_at?: FirestoreTimestampLike;
};

export type UnknownEvent = {
  id: string;
  event_id: string;
  camera_id: string;
  timestamp?: FirestoreTimestampLike;
  confidence: number;
  image_url?: string | null;
  recognition_status: 'unknown';
  review_status?: 'pending' | 'reviewed' | 'dismissed';
  second_best_confidence?: number;
  reviewed_at?: FirestoreTimestampLike;
  reviewed_by?: string;
  raspberry_pi_id: string;
  created_at?: FirestoreTimestampLike;
};

export type Camera = {
  id: string;
  camera_id: string;
  name: string;
  location?: string;
  status: 'online' | 'offline';
  raspberry_pi_id: string;
  last_error?: string | null;
  last_seen?: FirestoreTimestampLike;
  software_version?: string;
};

export type Device = {
  id: string;
  device_id: string;
  name: string;
  device_type: 'raspberry_pi' | 'laptop_ai';
  status: 'online' | 'offline';
  last_seen?: FirestoreTimestampLike;
  last_error?: string | null;
  software_version?: string;
};

export type ManagedUser = {
  id: string;
  name: string;
  student_id?: string;
  status: string;
  registration_date?: string;
  enrollment_samples?: number;
};

export type AdminAccount = {
  uid: string;
  email?: string | null;
  username?: string | null;
  display_name?: string | null;
  role: 'admin' | 'viewer';
  email_verified: boolean;
  disabled: boolean;
  created_at?: string | null;
  last_sign_in_at?: string | null;
};

export type UserSession = {
  id: string;
  uid: string;
  email: string;
  display_name?: string | null;
  current_tab: 'overview' | 'attendance' | 'users' | 'unknown' | 'devices' | 'admin';
  visibility: 'active' | 'hidden';
  last_seen?: FirestoreTimestampLike;
};
