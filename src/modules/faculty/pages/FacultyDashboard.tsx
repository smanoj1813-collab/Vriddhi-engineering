import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { db } from '@/Firebase/config';
import {
  collection, query, where, getDocs, orderBy, limit,
} from 'firebase/firestore';
import { fetchFacultyWeeklySchedule } from '../../admin/api/scheduleApi';
import FacultyAcademicPlanner from '../components/FacultyAcademicPlanner';
import MergedDivisionChip from '@/shared/components/MergedDivisionChip';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  CalendarToday,
  People,
  CheckCircle,
  UploadFile,
  Announcement,
  Assessment,
  School,
  TrendingUp,
  AccessTime,
  Badge as BadgeIcon,
} from '@mui/icons-material';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScheduleItem {
  id: string;
  subject: string;
  course: string;
  batch: string;
  division: string;
  section: string;
  time: string;
  room: string;
  status: 'upcoming' | 'ongoing' | 'completed';
}

interface AnnouncementItem {
  id: string;
  title: string;
  message: string;
  date: string;
  priority: 'high' | 'normal' | 'low';
}

interface QuickStat {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  path: string;
}

// ─── Firestore Helpers ────────────────────────────────────────────────────────
function collegeRef(collegeId: string, path: string) {
  return collection(db, 'colleges', collegeId, path);
}

// ─── Firestore Hook ───────────────────────────────────────────────────────────
function useFacultyData(collegeId: string | undefined, facultyId: string | undefined) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [stats, setStats] = useState({ totalClasses: 0, totalStudents: 0, attendanceRate: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!collegeId || !facultyId) {
      setLoading(false);
      return;
    }

    // Narrow types for the async closure
    const cid = collegeId;
    const fid = facultyId;
    let cancelled = false;

    async function fetchData() {
      try {
        // Fetch faculty schedule — read the same `weeklySchedules` collection the
        // admin writes to (via AdminClassSchedule), then show today's classes.
        // (Previously this read the legacy `colleges/{cid}/schedules` subcollection,
        // which admin scheduling never wrote to, so the widget stayed empty.)
        const weekly = await fetchFacultyWeeklySchedule(fid);
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const nowTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(
          new Date().getMinutes()
        ).padStart(2, '0')}`;

        const scheduleData: ScheduleItem[] = weekly
          .filter((w) => String(w.dayOfWeek || '').toLowerCase() === today)
          .map((w) => {
            const status: ScheduleItem['status'] =
              nowTime < (w.startTime || '99:99')
                ? 'upcoming'
                : nowTime > (w.endTime || '00:00')
                  ? 'completed'
                  : 'ongoing';
            return {
              id: w.id,
              subject: String(w.subject || 'Unknown'),
              course: String(w.branch || w.subjectCode || ''),
              batch: String(w.batch || ''),
              division: String(w.division || ''),
              section: String(w.section || ''),
              time: `${String(w.startTime || '--:--')} - ${String(w.endTime || '--:--')}`,
              room: String(w.room || 'TBD'),
              status,
            };
          })
          .sort((a, b) => a.time.localeCompare(b.time))
          .slice(0, 10);

        // Fetch announcements
        const announceSnap = await getDocs(
          query(
            collegeRef(cid, 'announcements'),
            orderBy('createdAt', 'desc'),
            limit(5)
          )
        );

        const announceData: AnnouncementItem[] = announceSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title || 'Announcement'),
            message: String(data.message || ''),
            date: data.createdAt?.toDate?.()?.toLocaleDateString?.() || 'Recently',
            priority: (data.priority as AnnouncementItem['priority']) || 'normal',
          };
        });

        // Fetch student count for faculty's classes
        const studentsSnap = await getDocs(
          query(
            collection(db, 'students'),
            where('collegeId', '==', cid)
          )
        );

        if (!cancelled) {
          setSchedule(scheduleData);
          setAnnouncements(announceData);
          setStats({
            totalClasses: scheduleData.length,
            totalStudents: studentsSnap.size,
            attendanceRate: 0,
          });
          setLoading(false);
        }
      } catch (err) {
        console.error('[FacultyDashboard] Fetch error:', err);
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [collegeId, facultyId]);

  return { schedule, announcements, stats, loading };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FacultyDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const facultyId = user?.uid || user?.id;
  const { schedule, announcements, stats, loading } = useFacultyData(user?.collegeId, facultyId);

  const quickActions: QuickStat[] = [
    {
      label: 'Mark Attendance',
      value: 'Take Now',
      icon: <CheckCircle />,
      color: '#14b8a6',
      path: '/faculty/attendance-marking',
    },
    {
      // A teacher's own attendance is a different thing from the class
      // attendance above it; both belong on the dashboard.
      label: 'My Attendance',
      value: 'Mark Self',
      icon: <BadgeIcon />,
      color: '#6366f1',
      path: '/faculty/my-attendance',
    },
    {
      label: 'My Students',
      value: String(stats.totalStudents),
      icon: <People />,
      color: '#0ea5e9',
      path: '/faculty/student-analysis',
    },
    {
      label: 'Upload Material',
      value: 'Upload',
      icon: <UploadFile />,
      color: '#f59e0b',
      path: '/faculty/upload-material',
    },
    {
      label: 'Universal Bank',
      value: 'View',
      icon: <School />,
      color: '#8b5cf6',
      path: '/faculty/universal-bank',
    },
  ];

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Box sx={{ width: 40, height: 40, border: '3px solid #14b8a6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', mx: 'auto', mb: 2 }} />
          <Typography color="text.secondary">Loading faculty dashboard...</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 0, md: 2 } }}>
      {/* Header */}
      <Paper sx={{ p: { xs: 2.5, md: 3 }, mb: 3, bgcolor: 'primary.main', color: 'white', borderRadius: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5, fontSize: { xs: '1.5rem', md: '2.125rem' } }}>
              Welcome back, {user?.name?.split(' ')[0] || 'Faculty'}
            </Typography>
            <Typography variant="body1" sx={{ opacity: 0.9 }}>
              {user?.department || 'Department'} · {stats.totalClasses} classes today
            </Typography>
          </Box>
          <Avatar sx={{ width: 56, height: 56, bgcolor: 'rgba(255,255,255,0.2)', fontSize: 24, fontWeight: 700, display: { xs: 'none', sm: 'flex' } }}>
            {user?.name?.charAt(0) || 'F'}
          </Avatar>
        </Box>
      </Paper>

      {/* Quick Actions */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {quickActions.map((action) => (
          <Grid size={{ xs: 6, sm: 6, md: 3 }} key={action.label}>
            <Card
              sx={{
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 },
              }}
              onClick={() => navigate(action.path)}
            >
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, md: 2 }, p: { xs: 1.5, md: 2 }, '&:last-child': { pb: { xs: 1.5, md: 2 } }, minHeight: 72 }}>
                <Avatar sx={{ bgcolor: `${action.color}20`, color: action.color, width: { xs: 36, md: 40 }, height: { xs: 36, md: 40 } }}>
                  {action.icon}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: action.color, fontSize: { xs: '0.95rem', md: '1.25rem' }, lineHeight: 1.2 }} noWrap>
                    {action.value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.72rem', md: '0.875rem' } }} noWrap>
                    {action.label}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Deterministic academic planning (getFacultyAcademicContext callable).
          Renders nothing when the backend feature gate is off. */}
      <FacultyAcademicPlanner />

      <Grid container spacing={3}>
        {/* Today's Schedule */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarToday color="primary" />
                Today's Schedule
              </Typography>
              <Chip label={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} size="small" />
            </Box>

            {schedule.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                <AccessTime sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                <Typography>No classes scheduled for today</Typography>
              </Box>
            ) : (
              <List>
                {schedule.map((item) => (
                  <ListItem
                    key={item.id}
                    sx={{
                      mb: 1,
                      borderRadius: 2,
                      bgcolor: item.status === 'ongoing' ? 'success.light' : 'background.paper',
                      border: '1px solid',
                      borderColor: item.status === 'ongoing' ? 'success.main' : 'divider',
                      alignItems: 'flex-start',
                      flexWrap: 'wrap',
                      gap: 1,
                      px: { xs: 1.5, md: 2 },
                      cursor: 'pointer',
                    }}
                    onClick={() => navigate('/faculty/attendance-marking')}
                  >
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: item.status === 'ongoing' ? 'success.main' : 'primary.main' }}>
                        <School />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {item.subject}
                        </Typography>
                      }
                      secondary={
                        <Box component="span" sx={{ display: 'block' }}>
                          <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
                            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{item.time}</Box>
                            {' · '}Room {item.room}
                            <Box component="span" sx={{ display: { xs: 'block', sm: 'inline' } }}>
                              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{' · '}</Box>
                              {item.course} {item.batch} · Div {[item.division, item.section].filter(Boolean).join(' / ').replace(/,/g, '+')}
                            </Box>
                          </Typography>
                          <MergedDivisionChip division={[item.division, item.section].filter(Boolean).join(',')} />
                        </Box>
                      }
                    />
                    <Chip
                      label={item.status}
                      size="small"
                      color={item.status === 'ongoing' ? 'success' : item.status === 'completed' ? 'default' : 'primary'}
                      variant={item.status === 'upcoming' ? 'outlined' : 'filled'}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        {/* Announcements */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Announcement color="primary" />
                Announcements
              </Typography>
            </Box>

            {announcements.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                <Announcement sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                <Typography>No announcements yet</Typography>
              </Box>
            ) : (
              <List>
                {announcements.map((item) => (
                  <ListItem
                    key={item.id}
                    sx={{
                      mb: 1,
                      borderRadius: 2,
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {item.title}
                          </Typography>
                          {item.priority === 'high' && (
                            <Chip label="Important" size="small" color="error" sx={{ height: 20 }} />
                          )}
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {item.message.slice(0, 80)}{item.message.length > 80 ? '...' : ''} · {item.date}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}