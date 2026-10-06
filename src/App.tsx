import { useEffect, useState } from 'react';
import { Projection } from './components/Projection';
import { StudentApp } from './components/student/StudentApp';
import { TeacherPanel } from './components/teacher/TeacherPanel';

interface Route {
  name: string;
  params: URLSearchParams;
}

function useRoute(): Route {
  const read = (): Route => {
    const [name, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
    return { name, params: new URLSearchParams(query) };
  };
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
  if (route.name === 'professor') return <TeacherPanel />;
  if (route.name === 'projecao') return <Projection code={route.params.get('codigo') ?? undefined} />;
  return <StudentApp />;
}
