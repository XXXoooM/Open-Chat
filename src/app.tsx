import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";
import WelcomePage from "@/pages/WelcomePage/WelcomePage";
import ChatPage from "@/pages/ChatPage/ChatPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<WelcomePage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
