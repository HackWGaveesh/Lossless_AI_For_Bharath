import React from 'react';
import { Link } from 'react-router-dom';
import { Phone, Globe, Zap, Shield } from 'lucide-react';
import Button from '../components/Common/Button';

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow bg-white">
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  );
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center text-center space-y-2">
      <div className="w-16 h-16 bg-primary-600 text-white rounded-full flex items-center justify-center text-2xl font-bold">
        {number}
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-gray-600 text-sm">{description}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <section className="container mx-auto px-4 py-20">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
          <div className="flex-1 space-y-6">
            <h1 className="text-5xl font-bold text-gray-900">
              VaaniSetu: सरकारी योजना, आपकी भाषा में
            </h1>
            <p className="text-xl text-gray-600">
              India's first voice-first AI platform bridging the digital divide for 900M rural Indians
            </p>
            <div className="flex gap-4">
              <Link to="/dashboard">
                <Button size="lg" className="px-8 py-4 text-lg">
                  Try Demo
                </Button>
              </Link>
              <Button variant="outline" size="lg" className="px-8 py-4 text-lg">
                Watch Video
              </Button>
            </div>
            <div className="flex gap-8 text-sm text-gray-500">
              <div>
                <span className="block text-2xl font-bold text-primary-600">896M</span>
                Indians Excluded
              </div>
              <div>
                <span className="block text-2xl font-bold text-primary-600">₹2.8L Cr</span>
                Unutilized
              </div>
              <div>
                <span className="block text-2xl font-bold text-primary-600">42%</span>
                Failure Rate
              </div>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center bg-primary-50 rounded-2xl p-8">
            <div className="text-6xl">📱</div>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Why VaaniSetu?</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <FeatureCard
              icon={<Phone className="w-12 h-12 text-primary-600" />}
              title="Voice-First"
              description="Natural conversations in your language. No typing, no reading required."
            />
            <FeatureCard
              icon={<Globe className="w-12 h-12 text-primary-600" />}
              title="22 Languages"
              description="Hindi, Tamil, Telugu, and 19 more languages with dialect support."
            />
            <FeatureCard
              icon={<Zap className="w-12 h-12 text-primary-600" />}
              title="Autonomous AI"
              description="AI agents fill forms, check status, and complete applications for you."
            />
            <FeatureCard
              icon={<Shield className="w-12 h-12 text-primary-600" />}
              title="Secure & Private"
              description="Bank-grade encryption. Your data is safe and never shared."
            />
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="flex flex-col md:flex-row items-center justify-center gap-8">
            <Step number={1} title="Speak" description="Call or speak in your language" />
            <div className="hidden md:block text-gray-300">→</div>
            <Step number={2} title="AI Understands" description="Multi-agent AI processes your request" />
            <div className="hidden md:block text-gray-300">→</div>
            <Step number={3} title="Form Filled" description="Autonomous form completion" />
            <div className="hidden md:block text-gray-300">→</div>
            <Step number={4} title="Approved" description="Track status till approval" />
          </div>
        </div>
      </section>

      <section className="bg-primary-600 text-white py-16">
        <div className="container mx-auto px-4 text-center space-y-6">
          <h2 className="text-4xl font-bold">Ready to Bridge the Digital Divide?</h2>
          <p className="text-xl opacity-90">Join 900 million Indians on their journey to digital empowerment</p>
          <Link to="/dashboard">
            <Button
              variant="outline"
              size="lg"
              className="bg-white text-primary-600 hover:bg-gray-100 px-10 py-4 text-lg"
            >
              Get Started Free
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
