import WelcomeHeroSection from './components/WelcomeHeroSection';
import NicknameInputSection from './components/NicknameInputSection';

export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center">
        <WelcomeHeroSection />
        <section className="w-full py-10 md:py-12">
          <div className="max-w-7xl mx-auto px-4 md:px-6">
            <NicknameInputSection />
          </div>
        </section>
      </main>
    </div>
  );
}
