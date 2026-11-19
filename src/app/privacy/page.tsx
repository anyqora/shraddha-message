import type { Metadata } from "next";

// Public privacy policy for the WhatsApp Business Platform listing (Meta
// requires a reachable privacy-policy URL with data-deletion instructions,
// linked at /privacy#data-deletion). Not behind auth — proxy.ts only guards
// the dashboard paths.

const BUSINESS_NAME = "Shrddha Consultancy";
const WHATSAPP_NUMBER = "+91 95615 65532";
const LAST_UPDATED = "12 November 2026";

export const metadata: Metadata = {
  title: `Privacy Policy — ${BUSINESS_NAME}`,
  description: `How ${BUSINESS_NAME} handles personal data in its WhatsApp messaging service.`,
  robots: { index: true, follow: true },
};

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="mt-8 mb-2 text-[16px] font-semibold text-foreground">
        {title}
      </h2>
      <div className="space-y-2 text-[14px] leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-frame px-4 py-10">
      <article className="mx-auto max-w-2xl rounded-lg border border-border bg-panel px-6 py-8 sm:px-10">
        <h1 className="text-[22px] font-semibold text-foreground">
          Privacy Policy
        </h1>
        <p className="mt-1 text-[13px] text-tertiary-foreground">
          {BUSINESS_NAME} · Last updated {LAST_UPDATED}
        </p>

        <Section title="Who we are">
          <p>
            {BUSINESS_NAME} (“we”, “us”) communicates with its customers on
            WhatsApp through the official WhatsApp Business Platform (Cloud
            API) provided by Meta. This policy explains what personal data we
            process when you message us or receive messages from us, why, and
            the choices you have.
          </p>
        </Section>

        <Section title="Data we collect">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Your WhatsApp phone number and the profile name you have set on
              WhatsApp.
            </li>
            <li>
              Messages you send us and messages we send you, including
              attachments, and their delivery and read status.
            </li>
            <li>
              Details you give us or that we hold as part of our service to
              you, such as your name, city, and order or service reference
              numbers.
            </li>
            <li>
              Your messaging preferences, including whether you have opted out
              of promotional messages.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              To reply to your enquiries and provide the services you have
              asked for.
            </li>
            <li>
              To send you service updates (for example about an application,
              order or account).
            </li>
            <li>
              To send offers and announcements, only where permitted, and never
              after you have opted out.
            </li>
            <li>
              To keep records of our communication and to improve our service.
            </li>
          </ul>
          <p>We do not sell your personal data.</p>
        </Section>

        <Section title="Who we share it with">
          <p>
            Messages are delivered through <Strong>Meta Platforms</Strong> (the
            WhatsApp Business Platform), whose processing is covered by
            WhatsApp’s own terms and privacy policy. Our messaging system is
            hosted with cloud infrastructure providers (application hosting and
            a managed database) that store the data on our behalf. We may also
            disclose data where required by law.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep conversation and contact records for as long as needed to
            provide our service and meet legal or accounting obligations, and
            then delete them. You can ask us to delete your data at any time
            (see below).
          </p>
        </Section>

        <Section title="Opting out of messages">
          <p>
            Reply <Strong>STOP</Strong> to any of our WhatsApp messages and you
            will no longer receive promotional broadcasts. Reply{" "}
            <Strong>START</Strong> to subscribe again. You can still contact us
            about your service at any time.
          </p>
        </Section>

        <Section id="data-deletion" title="Data deletion instructions">
          <p>To ask us to delete the personal data we hold about you:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Send a WhatsApp message to <Strong>{WHATSAPP_NUMBER}</Strong>{" "}
              saying “Delete my data”, from the phone number the data relates
              to.
            </li>
            <li>
              We will confirm your request and delete your contact details and
              message history from our system.
            </li>
            <li>
              We will reply to confirm once deletion is complete, normally
              within 30 days. Records we must keep by law are retained only for
              as long as required.
            </li>
          </ol>
        </Section>

        <Section title="Your rights">
          <p>
            You can ask us what data we hold about you, ask us to correct it,
            or ask us to delete it, by messaging us on WhatsApp at{" "}
            {WHATSAPP_NUMBER}.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. The date at the top
            shows when it was last changed.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            {BUSINESS_NAME} · WhatsApp {WHATSAPP_NUMBER}
          </p>
        </Section>
      </article>
    </main>
  );
}
