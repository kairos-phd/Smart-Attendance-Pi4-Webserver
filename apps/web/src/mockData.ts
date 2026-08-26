import type { Language } from './i18n';
import type { Attendance, Camera, ManagedUser, UnknownEvent } from './types';

function iso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function at(dayOffset: number, hour: number, minute: number) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

const stamp = (date: Date) => ({ toDate: () => date });

export function createMockData(language: Language): {
  attendance: Attendance[];
  unknown: UnknownEvent[];
  cameras: Camera[];
  users: ManagedUser[];
} {
  const attendanceMoments = [at(0, 8, 2), at(0, 8, 7), at(0, 8, 15), at(0, 13, 3), at(-1, 7, 58), at(-1, 8, 11), at(-3, 8, 5)];
  const people = [
    ['Nguyễn Minh Anh', 'SIC001', 'camera-1'],
    ['Trần Gia Huy', 'SIC002', 'camera-1'],
    ['Lê Khánh Linh', 'SIC003', 'camera-2'],
    ['Phạm Quốc Bảo', 'SIC004', 'camera-2'],
    ['Nguyễn Minh Anh', 'SIC001', 'camera-1'],
    ['Võ Hoàng Nam', 'SIC005', 'camera-2'],
    ['Trần Gia Huy', 'SIC002', 'camera-1'],
  ];
  const attendance: Attendance[] = attendanceMoments.map((moment, index) => ({
    id: `demo-attendance-${index + 1}`,
    attendance_id: `demo-attendance-${index + 1}`,
    user_id: people[index][1],
    name: people[index][0],
    camera_id: people[index][2],
    timestamp: stamp(moment),
    date: iso(moment),
    confidence: 0.91 + index * 0.008,
    status: 'recognized',
    raspberry_pi_id: 'pi-classroom-01',
  }));
  const unknownMoments = [at(0, 9, 34), at(-1, 14, 12)];
  const unknown: UnknownEvent[] = unknownMoments.map((moment, index) => ({
    id: `demo-unknown-${index + 1}`,
    event_id: `demo-unknown-${index + 1}`,
    camera_id: index === 0 ? 'camera-1' : 'camera-2',
    timestamp: stamp(moment),
    confidence: index === 0 ? 0.314 : 0.287,
    image_url: `demo://unknown/${index + 1}`,
    review_status: 'pending',
    recognition_status: 'unknown',
    raspberry_pi_id: 'pi-classroom-01',
  }));
  const cameraNames = language === 'vi' ? ['Camera lối vào', 'Camera khu vực làm việc'] : ['Entrance camera', 'Workspace camera'];
  const cameras: Camera[] = [
    { id: 'camera-1', camera_id: 'camera-1', name: cameraNames[0], location: language === 'vi' ? 'Lối vào chính' : 'Main entrance', status: 'online', raspberry_pi_id: 'pi-classroom-01', last_seen: stamp(at(0, new Date().getHours(), new Date().getMinutes())) },
    { id: 'camera-2', camera_id: 'camera-2', name: cameraNames[1], location: language === 'vi' ? 'Khu vực làm việc' : 'Workspace', status: 'online', raspberry_pi_id: 'pi-classroom-01', last_seen: stamp(at(0, new Date().getHours(), new Date().getMinutes())) },
  ];
  const users: ManagedUser[] = [
    { id: 'demo-user-1', name: 'Nguyễn Minh Anh', student_id: 'SIC001', status: 'active', registration_date: iso(at(-30, 9, 0)) },
    { id: 'demo-user-2', name: 'Trần Gia Huy', student_id: 'SIC002', status: 'active', registration_date: iso(at(-28, 9, 0)) },
    { id: 'demo-user-3', name: 'Lê Khánh Linh', student_id: 'SIC003', status: 'active', registration_date: iso(at(-25, 9, 0)) },
    { id: 'demo-user-4', name: 'Phạm Quốc Bảo', student_id: 'SIC004', status: 'inactive', registration_date: iso(at(-20, 9, 0)) },
  ];
  return { attendance, unknown, cameras, users };
}

export function localIsoDate(date = new Date()) {
  return iso(date);
}

export function offsetIsoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return iso(date);
}

export function startOfCurrentWeek() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return iso(date);
}
