'use client';

interface Props {
  href?: string;
  onClick?: () => void;
}

export default function BackButton({ href, onClick }: Props) {
  const cls = "inline-flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors text-sm group";

  const content = (
    <>
      <svg
        className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      <span>Back</span>
    </>
  );

  if (href) return <a href={href} className={cls}>{content}</a>;
  return <button onClick={onClick} className={cls}>{content}</button>;
}
