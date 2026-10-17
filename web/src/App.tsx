import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { I18nProvider } from "./lib/i18n";
import CheckIn from "./pages/CheckIn";
import Custodian from "./pages/Custodian";
import Drill from "./pages/Drill";
import Home from "./pages/Home";
import NewVault from "./pages/NewVault";
import VaultPage from "./pages/VaultPage";
import Vaults from "./pages/Vaults";
import Verify from "./pages/Verify";

// Hash routes, so the same static build works on Vercel, on GitHub Pages and from a saved copy.
export default function App() {
  return (
    <I18nProvider>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/drill" element={<Drill />} />
            <Route path="/new" element={<NewVault />} />
            <Route path="/checkin" element={<CheckIn />} />
            <Route path="/custodian" element={<Custodian />} />
            <Route path="/vaults" element={<Vaults />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/v/:vaultId/:creator" element={<VaultPage />} />
          </Routes>
        </Layout>
      </HashRouter>
    </I18nProvider>
  );
}
