import { LocationProvider, Router, Route, useLocation } from 'preact-iso'
import Home from './pages/Home'
import Flows from './pages/Flows'
import FlowRun from './pages/FlowRun'
import Providers from './pages/Providers'
import Functions from './pages/Functions'
import Crons from './pages/Crons'

function NavMenu() {
  const { url } = useLocation()

  return (
    <ui-nav-menu>
      <a href="/" rel="home" aria-current={url === '/' ? 'page' : undefined}>
        Home
      </a>
      <a href="/flows" aria-current={url.startsWith('/flows') ? 'page' : undefined}>
        Flows
      </a>
      <a href="/providers" aria-current={url === '/providers' ? 'page' : undefined}>
        Providers
      </a>
      <a href="/crons" aria-current={url === '/crons' ? 'page' : undefined}>
        Crons
      </a>
      <a href="/functions" aria-current={url.startsWith('/functions') ? 'page' : undefined}>
        Functions
      </a>
    </ui-nav-menu>
  )
}

export default function App() {
  return (
    <LocationProvider>
      <NavMenu />
      <Router>
        <Route path="/" component={Home} />
        <Route path="/flows" component={Flows} />
        <Route path="/flows/:name" component={Flows} />
        <Route path="/runs/:id" component={FlowRun} />
        <Route path="/crons" component={Crons} />
        <Route path="/providers" component={Providers} />
        <Route path="/functions" component={Functions} />
        <Route path="/functions/:handle" component={Functions} />
        <Route path="/functions/:handle/:action" component={Functions} />
      </Router>
    </LocationProvider>
  )
}
