import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Monitor,
  CheckCircle2,
  HardDrive,
  ExternalLink,
  ShieldCheck,
  Copy,
  Check,
  FolderGit2,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';

interface WindowsDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  appVersion?: string;
}

export const WindowsDownloadModal: React.FC<WindowsDownloadModalProps> = ({
  isOpen,
  onClose,
  appVersion = '1.8.0',
}) => {
  const [activeTab, setActiveTab] = useState<'downloads' | 'pipeline' | 'guide'>('downloads');
  const [repoSlug, setRepoSlug] = useState('manpig7805/blacksite-mod-manager');
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const cleanRepo = repoSlug.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const releaseBaseUrl = `https://github.com/${cleanRepo || 'manpig7805/blacksite-mod-manager'}/releases`;
  const setupExeUrl = `${releaseBaseUrl}/download/v${appVersion}-latest/Blacksite-Mod-Manager-Setup-${appVersion}.exe`;
  const portableExeUrl = `${releaseBaseUrl}/download/v${appVersion}-latest/Blacksite-Mod-Manager-Portable-${appVersion}.exe`;
  const actionsUrl = `https://github.com/${cleanRepo || 'manpig7805/blacksite-mod-manager'}/actions`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(label);
    setTimeout(() => setCopiedLink(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-[#181B20] border border-[#2B303C] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="px-5 py-4 border-b border-[#23272E] flex items-center justify-between bg-[#14161B]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#EA580C]/15 border border-[#EA580C]/30 flex items-center justify-center text-[#EA580C]">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#E8EAEE] tracking-tight">
                  Windows Desktop Application
                </h3>
                <span className="text-[11px] font-mono text-[#EA580C] bg-[#EA580C]/10 border border-[#EA580C]/30 px-2 py-0.5 rounded">
                  v{appVersion} .EXE
                </span>
              </div>
              <p className="text-xs text-[#9AA3AF]">
                Standalone desktop client with automated GitHub Releases on push
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-[#E8EAEE] p-1.5 rounded-md hover:bg-[#20252D] transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="px-5 pt-2 border-b border-[#23272E] bg-[#16181D] flex items-center gap-2">
          <button
            onClick={() => setActiveTab('downloads')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'downloads'
                ? 'text-[#EA580C] border-[#EA580C]'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Binaries</span>
          </button>
          <button
            onClick={() => setActiveTab('pipeline')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'pipeline'
                ? 'text-[#EA580C] border-[#EA580C]'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>GitHub Actions CI/CD</span>
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'guide'
                ? 'text-[#EA580C] border-[#EA580C]'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Setup & SPT Guide</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* TAB 1: DOWNLOADS */}
          {activeTab === 'downloads' && (
            <div className="space-y-4">
              {/* Repository Selector */}
              <div className="bg-[#121418] border border-[#23272E] rounded-lg p-3 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[#9AA3AF] shrink-0">
                  <FolderGit2 className="w-4 h-4 text-[#EA580C]" />
                  <span>GitHub Repository:</span>
                </div>
                <input
                  type="text"
                  value={repoSlug}
                  onChange={(e) => setRepoSlug(e.target.value)}
                  placeholder="username/repository"
                  className="bg-[#181B20] border border-[#2B303C] rounded px-2.5 py-1 text-xs text-[#E8EAEE] font-mono flex-1 focus:outline-none focus:border-[#EA580C]"
                  title="Target repository for GitHub Actions release downloads"
                />
                <a
                  href={releaseBaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[#EA580C] hover:text-[#F97316] flex items-center gap-1 shrink-0 font-medium"
                >
                  <span>Releases</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Dual Download Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 1. Setup Installer */}
                <div className="bg-[#121418] border border-[#2B303C] hover:border-[#EA580C]/50 rounded-xl p-4 flex flex-col justify-between transition-all">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-[#16A34A] bg-[#16A34A]/10 border border-[#16A34A]/30 px-2 py-0.5 rounded">
                        RECOMMENDED
                      </span>
                      <span className="text-xs text-[#6B7480] font-mono">Windows 64-bit</span>
                    </div>
                    <h4 className="text-sm font-bold text-[#E8EAEE] mb-1">
                      Windows Setup Installer
                    </h4>
                    <p className="text-xs text-[#9AA3AF] leading-relaxed mb-3">
                      Standard NSIS installer. Automatically adds desktop & Start Menu shortcuts, manages application directories, and clean uninstallation.
                    </p>
                    <div className="text-[11px] text-[#6B7480] font-mono mb-4 break-all bg-[#181B20] p-1.5 rounded border border-[#23272E]">
                      Blacksite-Mod-Manager-Setup-{appVersion}.exe
                    </div>
                  </div>

                  <div className="space-y-2">
                    <a
                      href={setupExeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Installer (.exe)</span>
                    </a>
                    <button
                      onClick={() => copyToClipboard(setupExeUrl, 'setup')}
                      className="w-full bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-[#E8EAEE] text-[11px] py-1 px-2 rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copiedLink === 'setup' ? (
                        <>
                          <Check className="w-3 h-3 text-[#16A34A]" />
                          <span className="text-[#16A34A]">Copied direct URL</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Direct Download Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 2. Portable Standalone */}
                <div className="bg-[#121418] border border-[#2B303C] hover:border-[#3B82F6]/50 rounded-xl p-4 flex flex-col justify-between transition-all">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-[#3B82F6] bg-[#3B82F6]/10 border border-[#3B82F6]/30 px-2 py-0.5 rounded">
                        ZERO-INSTALL
                      </span>
                      <span className="text-xs text-[#6B7480] font-mono">Windows 64-bit</span>
                    </div>
                    <h4 className="text-sm font-bold text-[#E8EAEE] mb-1">
                      Portable Standalone .EXE
                    </h4>
                    <p className="text-xs text-[#9AA3AF] leading-relaxed mb-3">
                      Single-file executable with zero setup. Run directly from your desktop, portable drive, or drop right into your SPT directory root.
                    </p>
                    <div className="text-[11px] text-[#6B7480] font-mono mb-4 break-all bg-[#181B20] p-1.5 rounded border border-[#23272E]">
                      Blacksite-Mod-Manager-Portable-{appVersion}.exe
                    </div>
                  </div>

                  <div className="space-y-2">
                    <a
                      href={portableExeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full bg-[#20252D] hover:bg-[#2A313C] border border-[#2B303C] hover:border-[#3B82F6]/60 text-[#E8EAEE] text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-[#3B82F6]" />
                      <span>Download Portable (.exe)</span>
                    </a>
                    <button
                      onClick={() => copyToClipboard(portableExeUrl, 'portable')}
                      className="w-full bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-[#E8EAEE] text-[11px] py-1 px-2 rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copiedLink === 'portable' ? (
                        <>
                          <Check className="w-3 h-3 text-[#16A34A]" />
                          <span className="text-[#16A34A]">Copied direct URL</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Direct Download Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Desktop Advantages Checklist */}
              <div className="bg-[#121418] border border-[#23272E] rounded-xl p-3.5 space-y-2 text-xs">
                <div className="text-[11px] font-semibold text-[#9AA3AF] uppercase tracking-wider">
                  Why use the Windows Desktop Edition?
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[#9AA3AF]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span>Direct SPT filesystem file writes</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span>Background SPT server log monitor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span>Zero browser security prompts</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span>Automatic offline profile saving</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CI/CD PIPELINE */}
          {activeTab === 'pipeline' && (
            <div className="space-y-3 text-xs">
              <div className="bg-[#121418] border border-[#23272E] rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#EA580C]">
                  <FolderGit2 className="w-4 h-4" />
                  <h4 className="text-sm font-bold text-[#E8EAEE]">
                    Automated GitHub Actions Release Pipeline
                  </h4>
                </div>
                <p className="text-[#9AA3AF] leading-relaxed">
                  Your project contains an active CI/CD workflow at{' '}
                  <code className="bg-[#181B20] text-[#EA580C] px-1.5 py-0.5 rounded border border-[#23272E] font-mono">
                    .github/workflows/build-windows-exe.yml
                  </code>
                  . Every time you push to the <code className="text-[#E8EAEE]">main</code> or <code className="text-[#E8EAEE]">master</code> branch, GitHub automatically executes:
                </p>

                <div className="space-y-2 bg-[#16181D] p-3 rounded-lg border border-[#23272E] font-mono text-[11px]">
                  <div className="flex items-center gap-2 text-[#E8EAEE]">
                    <span className="w-5 h-5 rounded-full bg-[#EA580C]/20 text-[#EA580C] flex items-center justify-center text-[10px]">1</span>
                    <span>Spin up Windows-latest virtual runner</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#E8EAEE]">
                    <span className="w-5 h-5 rounded-full bg-[#EA580C]/20 text-[#EA580C] flex items-center justify-center text-[10px]">2</span>
                    <span>Compile Vite web bundle with relative desktop assets</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#E8EAEE]">
                    <span className="w-5 h-5 rounded-full bg-[#EA580C]/20 text-[#EA580C] flex items-center justify-center text-[10px]">3</span>
                    <span>Package NSIS installer & Portable EXE via electron-builder</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#E8EAEE]">
                    <span className="w-5 h-5 rounded-full bg-[#16A34A]/20 text-[#16A34A] flex items-center justify-center text-[10px]">4</span>
                    <span>Attach .exe binaries to GitHub Release tagged v{appVersion}-latest</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-[#23272E]">
                  <span className="text-[#6B7480]">Check running build jobs on GitHub:</span>
                  <a
                    href={actionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-[#20252D] hover:bg-[#282F3A] text-[#EA580C] hover:text-[#F97316] px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors font-medium cursor-pointer"
                  >
                    <span>View GitHub Actions</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SETUP & SPT GUIDE */}
          {activeTab === 'guide' && (
            <div className="space-y-3 text-xs text-[#9AA3AF]">
              <div className="bg-[#121418] border border-[#23272E] rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-bold text-[#E8EAEE] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#16A34A]" />
                  <span>3-Step Quick Start for Tarkov Modders</span>
                </h4>

                <div className="space-y-3">
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded bg-[#20252D] text-[#EA580C] font-bold flex items-center justify-center shrink-0">1</span>
                    <div>
                      <div className="text-[#E8EAEE] font-medium">Run Blacksite on Windows</div>
                      <p className="text-[11px] text-[#6B7480] mt-0.5">
                        Launch <code className="text-[#9AA3AF]">Blacksite-Mod-Manager-Setup.exe</code> or run the portable executable directly without installing.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded bg-[#20252D] text-[#EA580C] font-bold flex items-center justify-center shrink-0">2</span>
                    <div>
                      <div className="text-[#E8EAEE] font-medium">Link your SPT Directory</div>
                      <p className="text-[11px] text-[#6B7480] mt-0.5">
                        Click the orange <strong>Set SPT Directory</strong> button in the header and select your Tarkov folder (e.g. <code className="text-[#9AA3AF]">C:\Games\SPT-Tarkov</code> or <code className="text-[#9AA3AF]">D:\SPT-4.0</code>).
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded bg-[#20252D] text-[#EA580C] font-bold flex items-center justify-center shrink-0">3</span>
                    <div>
                      <div className="text-[#E8EAEE] font-medium">Browse, Install & Launch</div>
                      <p className="text-[11px] text-[#6B7480] mt-0.5">
                        Search and 1-click install mods from the Forge repository. Blacksite automatically extracts files to the correct <code className="text-[#9AA3AF]">user/mods</code> or <code className="text-[#9AA3AF]">BepInEx/plugins</code> folders.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#14161B] flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-[#6B7480]">
            <Sparkles className="w-3.5 h-3.5 text-[#EA580C]" />
            <span>Target Platform: Windows 10 / 11 (x64)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-[#20252D] hover:bg-[#282F3A] text-[#E8EAEE] font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
