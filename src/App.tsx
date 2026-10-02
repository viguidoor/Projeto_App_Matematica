import { useEffect, useState } from 'react';
import { Projection } from './components/Projection';
import { StudentApp } from './components/student/StudentApp';
import { TeacherPanel } from './components/teacher/TeacherPanel';

function useRoute(): string {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  if (route === 'professor') return <TeacherPanel />;
  if (route === 'projecao') return <Projection />;
  return <StudentApp />;
}
