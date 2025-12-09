'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { FC } from 'react';

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  collection,
  addDoc,
  updateDoc,
  getDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import {
  Bold,
  Italic,
  Type,
  FileCode,
  BookOpen,
  Heading1,
  Heading2,
  CheckCircle,
  Save,
  X,
  MessageSquare,
  Send,
  Bot,
  Settings,
  ShieldCheck,
  User as UserIcon,
  Edit3,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';


// --- Debounce function ---
const debounce = (func: Function, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// --- Improved bidi sanitization ---
export const sanitizeBidi = (html: string) =>
  html.replace(/[\u202A-\u202E\u200E\u200F\u061C]/g, '');

// --- Save and restore cursor position ---
const saveCursorPosition = (el: HTMLElement) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(el);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  const caretOffset = preCaretRange.toString().length;
  
  return caretOffset;
};

const restoreCursorPosition = (el: HTMLElement, caretOffset: number) => {
  const selection = window.getSelection();
  if (!selection) return;
  
  let charCount = 0;
  const walker = document.createTreeWalker(
    el,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let node;
  // eslint-disable-next-line no-cond-assign
  while (node = walker.nextNode()) {
    const nodeLength = node.textContent?.length || 0;
    if (charCount + nodeLength >= caretOffset) {
      const range = document.createRange();
      range.setStart(node, caretOffset - charCount);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    charCount += nodeLength;
  }
  
  // If we couldn't find the exact position, place cursor at end
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};
const safeRestoreCursor = (el: HTMLElement, pos: number | null) => {
  requestAnimationFrame(() => {
    if (pos !== null) {
      restoreCursorPosition(el, pos);
    }
  });
};

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: 'AIzaSyBFoSNbK6VlHMi-GSRTcMJNQc4_uQLyeeo',
  authDomain: 'flexee-manual.firebaseapp.com',
  projectId: 'flexee-manual',
  storageBucket: 'flexee-manual.firebasestorage.app',
  messagingSenderId: '926016274014',
  appId: '1:926016274014:web:9f1572b584e28a4a5f7ecf',
  measurementId: 'G-QHJMT74XPQ',
};

// Initialize Firebase (safe for hot reload)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

interface Message {
  role: 'assistant' | 'user';
  text: string;
}
interface PageMeta {
  id: string;
  title: string;
}
interface ToolbarButtonProps {
  onClick?: () => void;
  icon: any;
  title?: string;
  active?: boolean;
}

const ToolbarButton: FC<ToolbarButtonProps> = ({
  onClick,
  icon: Icon,
  title,
  active = false,
}) => (
  <button
    type="button"
    title={title}
    onMouseDown={(e) => {
      // Prevent button from stealing focus so execCommand
      // still applies to the editor selection.
      e.preventDefault();
      onClick?.();
    }}
    className={`p-2 rounded hover:bg-slate-200 transition-colors ${
      active ? 'bg-slate-300 text-indigo-700' : 'text-slate-700'
    }`}
  >
    <Icon size={18} />
  </button>
);
const handleEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
  if (e.key !== "Enter") return;

  e.preventDefault();

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  // Create a new paragraph block
  const newP = document.createElement("p");
  newP.innerHTML = "<br>";

  // Insert it after the current block
  const currentNode =
    range.startContainer.nodeType === 3
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);

  let parentBlock = currentNode;
  while (parentBlock && parentBlock !== e.currentTarget) {
    if (["P", "DIV", "H1", "H2"].includes(parentBlock.nodeName)) break;
    parentBlock = parentBlock.parentElement as HTMLElement;
  }

  if (parentBlock && parentBlock.parentNode) {
    parentBlock.parentNode.insertBefore(newP, parentBlock.nextSibling);

    // Move cursor into the new paragraph
    const newRange = document.createRange();
    newRange.setStart(newP, 0);
    newRange.collapse(true);

    sel.removeAllRanges();
    sel.addRange(newRange);
  }
};


const App: FC = () => {
  const defaultContent = `
    <h4> Loading... </h4>
    <p> Please wait while we load your content. </p>
  `;

  // --- Core State ---
  const [content, setContent] = useState(defaultContent);
  const [pages, setPages] = useState<PageMeta[]>([]);
const [activePageId, setActivePageId] = useState<string | null>(null);
const [isPagesLoading, setIsPagesLoading] = useState(true);
const hasInitializedPagesRef = useRef(false);
const [showDeleteFor, setShowDeleteFor] = useState<string | null>(null);
const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
const [renameValue, setRenameValue] = useState('');
  const [role, setRole] = useState<'admin' | 'reader'>('reader');
  const [saveStatus, setSaveStatus] = useState<'Saved' | 'Saving...' | 'Error'>('Saved');
  const [apiKey, setApiKey] = useState('');
const [lastDeletedPage, setLastDeletedPage] = useState<any | null>(null);
const [undoVisible, setUndoVisible] = useState(false);
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Editor State
  const [showSource, setShowSource] = useState<boolean>(false);
  const [showChat, setShowChat] = useState<boolean>(false);
  const [showAuditor, setShowAuditor] = useState<boolean>(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const applyBlockTag = (tag: "H1" | "H2" | "P") => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);

    // Ensure we start from an element, not a text node
    let node =
      range.startContainer.nodeType === 3
        ? range.startContainer.parentElement!
        : (range.startContainer as HTMLElement);

    // Find the nearest block element (p, div, h1, h2)
    while (
      node &&
      node !== editorRef.current &&
      !["P", "DIV", "H1", "H2"].includes(node.nodeName)
    ) {
      node = node.parentElement as HTMLElement;
    }

    if (!node || node === editorRef.current) return;

    // Create the new block item
    const newBlock = document.createElement(tag);
    newBlock.innerHTML = node.innerHTML;

    // Replace the old block with new block
    node.replaceWith(newBlock);

    // Move cursor inside new block
    const newRange = document.createRange();
    newRange.selectNodeContents(newBlock);
    newRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(newRange);
  };

  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  // AI State
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Hello! I am the Flexee Reader Bot. Ask me anything about the manual.',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatTyping, setIsChatTyping] = useState(false);

  // Auditor State
  const [auditResults, setAuditResults] = useState<string[]>([]);
  const [corrections, setCorrections] = useState<
  { original: string; corrected: string }[]
>([]);

const [selectedCorrections, setSelectedCorrections] = useState<Set<number>>(new Set());
const toggleCorrection = (index: number) => {
  setSelectedCorrections(prev => {
    const updated = new Set(prev);
    if (updated.has(index)) updated.delete(index);
    else updated.add(index);
    return updated;
  });
};

const toggleSelectAll = () => {
  if (selectedCorrections.size === corrections.length) {
    setSelectedCorrections(new Set());
  } else {
    setSelectedCorrections(new Set(corrections.map((_, i) => i)));
  }
};


  const [auditType, setAuditType] = useState<'consistency' | 'grammar' | 'code'>(
    'consistency'
  );
  const [isAuditing, setIsAuditing] = useState<boolean>(false);

  // --- Editor Typing State ---
  const [isEditing, setIsEditing] = useState(false);
  const editingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCursorPositionRef = useRef<number | null>(null);
  const typingRef = useRef(false);

  // --- Text Formatting State ---
  const [formatState, setFormatState] = useState({
    bold: false,
    italic: false,
    h1: false,
    h2: false,
    p: false,
  });

  // --- Detect Formatting on Selection ---
  const updateFormatState = () => {
    let block = document.queryCommandValue("formatBlock");

    if (block) {
      block = block.toLowerCase().replace(/[<>]/g, "");
    }

    setFormatState({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      // Different browsers may return "<h1>" or "heading 1"
      h1: block === "h1" || block === "heading 1",
      h2: block === "h2" || block === "heading 2",
      // Paragraph sometimes appears as "p", "paragraph", or "div"
      p: block === "p" || block === "paragraph" || block === "div",
    });
  };

  // --- Initialization ---
  // useEffect(() => {
  //   const savedKey = "AIzaSyDDkxZ0WaYq2w9wY4ONWAsjdEMVqhsr8jc";
  //   if (savedKey) setApiKey(savedKey);
  // }, []);

useEffect(() => {
  // Read key injected at build time by Next.js
  const envKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY as string | undefined;
  // console.log("Loaded Gemini API Key from env:", envKey);
  // Optionally fallback to a saved key in localStorage (if you used that before)
  const savedKey = envKey ?? localStorage.getItem('flexee_api_key') ?? '';

  if (savedKey) {
    setApiKey(savedKey);
    // Keep localStorage for convenience (optional)
    try {
      localStorage.setItem('flexee_api_key', savedKey);
    } catch (e) {
      // ignore if storage not available
    }
  }
}, []);

  useEffect(() => {
  const handleClick = () => {
    if (undoVisible) setUndoVisible(false);
  };

  // Clicking anywhere hides undo
  document.addEventListener("click", handleClick);

  return () => document.removeEventListener("click", handleClick);
}, [undoVisible]);
  // Keep toolbar buttons active based on selection
  useEffect(() => {
    document.addEventListener("selectionchange", updateFormatState);
    return () => document.removeEventListener("selectionchange", updateFormatState);
  }, []);

  // --- Auth Listener ---
  // --- Load list of pages & create default if none ---
useEffect(() => {
  const pagesCol = collection(db, 'manualPages');

  const unsub = onSnapshot(pagesCol, async (snap) => {
    setIsPagesLoading(false);

    // First-time initialization: migrate old single "main" doc
    if (snap.empty && !hasInitializedPagesRef.current) {
      hasInitializedPagesRef.current = true;
      try {
        const mainRef = doc(db, 'manuals', 'main');
        const mainSnap = await getDoc(mainRef);
        const initialContent =
          (mainSnap.exists() && (mainSnap.data() as any).content) ||
          defaultContent;

        const newDocRef = await addDoc(pagesCol, {
          title: 'Page 1',
          content: initialContent,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        setActivePageId(newDocRef.id);
      } catch (e) {
        console.error('Error initializing first page', e);
      }
      return;
    }

    // Normal: map pages into state
    const list: PageMeta[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      list.push({
        id: d.id,
        title: data.title || 'Untitled page',
      });
    });
    setPages(list);

    // If no active page yet, pick the first one
    if (!activePageId && list.length > 0) {
      setActivePageId(list[0].id);
    }
  });

  return () => unsub();
}, [activePageId, defaultContent]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setRole('admin');
      } else {
        setRole('reader');
      }
    });

    return () => unsub();
  }, []);

  // --- Create debounced update function ---
  const debouncedUpdate = useMemo(
  () =>
    debounce(async (newContent: string, pageId: string | null) => {
      if (!pageId) return; // no active page yet

      const clean = sanitizeBidi(newContent);
      setContent(clean);
      setSaveStatus('Saving...');

      try {
        const ref = doc(db, 'manualPages', pageId);
        await setDoc(
          ref,
          { content: clean, updatedAt: Date.now() },
          { merge: true }
        );
        setSaveStatus('Saved');
      } catch (error) {
        console.error(error);
        setSaveStatus('Error');
      }
    }, 1000),
  []
);
// --- Firestore Listener with improved cursor handling & per-page content ---
useEffect(() => {
  if (!activePageId) return;

  const ref = doc(db, 'manualPages', activePageId);

  const unsub = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;

    const data = snap.data() as { content?: string };
    const clean = sanitizeBidi(data.content || "");

    // ⛔ NEW — Prevent overwrite while admin is typing (avoids cursor jump)
    if (typingRef.current) return;
    // Prevent Firestore overwrite when grammar highlights are visible
const grammarActive =
  auditType === "grammar" &&
  corrections.length > 0 &&
  editorRef.current?.innerHTML.includes('grammar-error');

if (grammarActive) return;


    // Do nothing if content is already up-to-date
    if (clean === content) return;

    // Update React state
    setContent(clean);

    // Update editor only if it exists
    if (editorRef.current) {
      const el = editorRef.current;

      // Save cursor before updating DOM
      const cursorPos = saveCursorPosition(el);
      lastCursorPositionRef.current = cursorPos;

      // Replace content safely
      el.innerHTML = clean;

      // Restore cursor after DOM update
    
      if (editorRef.current) {
  safeRestoreCursor(editorRef.current, cursorPos);
}

      
    }
  });

  return () => unsub();
}, [activePageId, content]);


  // --- Ensure editor always shows content when returning to admin mode ---
  useEffect(() => {
    if (role === "admin" && !showSource && editorRef.current) {
      editorRef.current.innerHTML = content;
    }
  }, [role, showSource, content]);

  // --- Much improved input handler with typing detection ---
  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (role !== 'admin') return;
      // NEW → mark that admin is typing
  typingRef.current = true;
  setTimeout(() => {
    typingRef.current = false;
  }, 800);
    // Set editing state
    setIsEditing(true);
    
    // Clear any existing timeout
    if (editingTimeoutRef.current) {
      clearTimeout(editingTimeoutRef.current);
    }
    
    // Set a new timeout to clear editing state
    editingTimeoutRef.current = setTimeout(() => {
      setIsEditing(false);
    }, 500); // 500ms after last keystroke

    const el = e.currentTarget as HTMLDivElement;
    let html = el.innerHTML;
    
    // Save cursor position for bidi sanitization
    const cursorPos = saveCursorPosition(el);
    
    // Check for problematic characters
    const hasBidiChars = /[\u202A-\u202E\u200E\u200F\u061C]/.test(html);
    
    if (hasBidiChars) {
      // Clean the content
      const clean = sanitizeBidi(html);
      el.innerHTML = clean;
      
      // Restore cursor position if we have one
      if (cursorPos !== null) {
        setTimeout(() => {
          restoreCursorPosition(el, cursorPos);
        }, 0);
      }
      
      html = clean;
    }

    // Update cursor position ref
    lastCursorPositionRef.current = cursorPos;
    
    // Debounce the update to Firestore
    debouncedUpdate(html, activePageId);
  };

  // --- Handle paste events to prevent bidi injection ---
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (role !== 'admin') return;
    
    e.preventDefault();
    const paste = e.clipboardData.getData('text/plain');
    const clean = sanitizeBidi(paste);
    
    // Insert cleaned text at cursor
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(clean));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Trigger input event to save
      if (editorRef.current) {
        handleInput({ currentTarget: editorRef.current } as any);
      }
    }
  };

  // --- Focus handler to restore cursor if needed ---
  const handleEditorFocus = () => {
    if (role !== 'admin' || !editorRef.current) return;
    
    // If we have a saved cursor position and editor is empty or cursor is at start
    if (lastCursorPositionRef.current !== null) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const cursorAtStart = range.startOffset === 0 && range.endOffset === 0;
        
        if (cursorAtStart) {
          setTimeout(() => {
            restoreCursorPosition(editorRef.current!, lastCursorPositionRef.current!);
          }, 0);
        }
      }
    }
  };
  // --- Document tab actions ---

const handleAddPage = async () => {
  try {
    const pagesCol = collection(db, 'manualPages');
    const newIndex = pages.length + 1;

    const newRef = await addDoc(pagesCol, {
      title: `Page ${newIndex}`,
      content: defaultContent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    setActivePageId(newRef.id);

    if (editorRef.current) {
      editorRef.current.innerHTML = defaultContent;
    }
  } catch (e) {
    console.error('Error adding page', e);
  }
};

const startRenamePage = (page: PageMeta) => {
  setRenamingPageId(page.id);
  setRenameValue(page.title);
};

const commitRenamePage = async () => {
  if (!renamingPageId) return;
  const newName = renameValue.trim() || 'Untitled page';

  try {
    const ref = doc(db, 'manualPages', renamingPageId);
    await updateDoc(ref, { title: newName });
  } catch (e) {
    console.error('Error renaming page', e);
  } finally {
    setRenamingPageId(null);
  }
};
const handleDeletePage = async (pageId: string) => {
  if (pages.length === 1) {
    alert("You cannot delete the only remaining page.");
    return;
  }

  const confirmDelete = confirm("Are you sure you want to delete this page?");
  if (!confirmDelete) return;

  try {
    // Before deletion → save page data for undo
    const pageToDelete = pages.find((p) => p.id === pageId);

    if (pageToDelete) {
      const snap = await getDoc(doc(db, "manualPages", pageId));
      if (snap.exists()) {
        setLastDeletedPage({
  id: pageId,
  title: pageToDelete.title,
  content: (snap.data() as any).content || "",
});
setUndoVisible(true); 
      }
    }

    // Delete from database
    await deleteDoc(doc(db, "manualPages", pageId));

    // Switch to first available page
    const remaining = pages.filter((p) => p.id !== pageId);
    if (remaining.length > 0) {
      setActivePageId(remaining[0].id);
    }
  } catch (e) {
    console.error("Error deleting page:", e);
  }
};

  // --- Auth Actions ---
  const handleLogin = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setAuthLoading(false);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Login failed');
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setAuthLoading(true);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      console.log("Google Logged In:", result.user);
      setAuthLoading(false);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || "Google login failed");
      setAuthLoading(false);
    }
  };

  const handleSignUp = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setAuthLoading(false);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Sign up failed');
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setRole('reader');
  };

  const callGemini = async (systemPrompt: string, userPrompt: string): Promise<string | null> => {
  if (!apiKey) {
    alert('Please enter a Google Gemini API Key in the Settings.');
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${systemPrompt}\n\nUser Input: ${userPrompt}` }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();
    
    if (data.error) {
      console.error('Gemini API Error:', data.error);
      
      // Handle rate limit errors more gracefully
      if (data.error.code === 429) {
        return "⚠️ Rate limit reached. Please wait a minute before trying again. Free tier allows 15 requests per minute.";
      }
      
      return `Error: ${data.error.message}`;
    }
    
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

  } catch (error) {
    console.error(error);
    return "Error connecting to AI.";
  }
};


  const handleUserChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg: Message = { role: 'user', text: chatInput };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setIsChatTyping(true);

    const manualText = editorRef.current
      ? editorRef.current.innerText
      : content.replace(/<[^>]*>?/gm, '');
    const systemPrompt = `You are a helpful support agent for a software manual. Here is the manual content: --- ${manualText} --- Answer strictly based on this text.`;

    const reply = await callGemini(systemPrompt, userMsg.text);
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', text: reply || "I'm having trouble responding." },
    ]);
    setIsChatTyping(false);
  };

  const runAudit = async () => {
    setIsAuditing(true);
    setAuditResults([]);

    const manualText = editorRef.current
      ? editorRef.current.innerText
      : content.replace(/<[^>]*>?/gm, '');
    let prompt = '';

    if (auditType === 'consistency') {
      prompt = `Analyze the following technical manual for internal inconsistencies. 
        For example, does Chapter 1 say "Port 80" but Chapter 3 says "Port 8080"? 
        Do instructions in the intro contradict later sections?
        List specific discrepancies found. If none, say "No inconsistencies found."
        Manual Content: ${manualText}`;
    } else if (auditType === 'grammar') {
  prompt = `Identify grammar mistakes and return corrections in this exact format:

Original: <wrong sentence>
Corrected: <correct sentence>

Return ONLY pairs. No explanations.

Manual Content:
${manualText}`;
    } else if (auditType === 'code') {
      prompt = `Scan the text for any technical instructions or code snippets. 
        Verify if they look syntactically correct and logical. 
        Identify any commands that look dangerous or incorrect.
        Manual Content: ${manualText}`;
    }

    const result = await callGemini('You are an expert Technical Auditor.', prompt);
if (auditType === "grammar") {
  const lines = (result || "").split("\n");
  const list: { original: string; corrected: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Original:")) {
      const original = lines[i].replace("Original:", "").trim();
      const corrected = lines[i + 1]?.replace("Corrected:", "").trim();
      if (original && corrected) {
        list.push({ original, corrected });
      }
    }
  }

  setCorrections(list);
   // 🔥 highlight errors inside editor
 
}
    const formattedResults = result
      ? result.split('\n').filter((line: string) => line.trim().length > 0)
      : ['No response from Auditor.'];
    setAuditResults(formattedResults);
    setIsAuditing(false);
  };
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
const saveAs = require("file-saver").saveAs;

const handleDownloadAuditReport = async () => {
  if (!auditResults || auditResults.length === 0) {
    alert("No audit results available to download.");
    return;
  }

  let children = [];

  // --- TITLE ---
  children.push(
    new Paragraph({
      text: "FLEXEE AI AUDIT REPORT",
      heading: HeadingLevel.TITLE,
      spacing: { after: 300 },
    })
  );

  // --- AUDIT TYPE ---
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Audit Type: ", bold: true, size: 28 }),
        new TextRun({
          text: auditType.toUpperCase(),
          color: "1E90FF",
          bold: true,
          size: 28,
        }),
      ],
      spacing: { after: 200 },
    })
  );

  // --- DATE ---
  children.push(
    new Paragraph({
      text: `Generated On: ${new Date().toLocaleString()}`,
      spacing: { after: 400 },
    })
  );

  // --- SECTION HEADER ---
  children.push(
    new Paragraph({
      text: "Audit Findings",
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  // -------------------------------------------------------------------
  //               CONSISTENCY MODE (Highlight keywords only)
  // -------------------------------------------------------------------

  if (auditType === "consistency") {
    auditResults.forEach((line) => {
      const keywords = line.match(/\b[A-Z0-9]+\b/g) || []; // detect IMPORTANT words

      let parts = [];
      let remaining = line;

      keywords.forEach((key) => {
        const idx = remaining.indexOf(key);
        if (idx !== -1) {
          // normal text before keyword
          parts.push(new TextRun(remaining.substring(0, idx)));

          // highlighted keyword only
          parts.push(
            new TextRun({
              text: key,
              highlight: "yellow",
              bold: true,
            })
          );

          remaining = remaining.substring(idx + key.length);
        }
      });

      parts.push(new TextRun(remaining));

      children.push(
        new Paragraph({
          children: parts,
          spacing: { after: 200 },
        })
      );
    });
  }

  // -------------------------------------------------------------------
  //               GRAMMAR MODE (Original = Red, Corrected = Green)
  // -------------------------------------------------------------------

if (auditType === "grammar" && corrections.length > 0) {
  corrections.forEach((pair) => {

    // ORIGINAL (only the word Original is red)
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Original",
            color: "FF0000", // red
            bold: true,
          }),
          new TextRun({
            text: ": " + pair.original, 
            color: "000000", // black normal text
          }),
        ],
        spacing: { after: 150 },
      })
    );

    // CORRECTED (only the word Corrected is green)
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Corrected",
            color: "008000", // green
            bold: true,
          }),
          new TextRun({
            text: ": " + pair.corrected,
            color: "000000", // black normal text
          }),
        ],
        spacing: { after: 300 },
      })
    );

  });
}


  // -------------------------------------------------------------------
  //               DEFAULT MODE (Technical / Code Review)
  // -------------------------------------------------------------------

  if (auditType === "code") {
    auditResults.forEach((line) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "• ", bold: true }),
            new TextRun({
              text: line,
              color: "FF0000",
              highlight: "yellow",
            }),
          ],
          spacing: { after: 150 },
        })
      );
    });
  }

  // -------------------------------------------------------------------
  //               MAKE DOCUMENT + DOWNLOAD
  // -------------------------------------------------------------------

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `flexee-audit-report-${Date.now()}.docx`);
};


  // ------------------- THEME LOGIC -------------------
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(saved);
    } else {
      // Default theme = light
      document.documentElement.classList.add("light");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);

    localStorage.setItem("theme", newTheme);

    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(newTheme);
  };
  // -----------------------------------------------------

  // ------------- ADMIN EXTRA ACTIONS (SAVE / SPLIT) -------------

  const handleSaveAsHTML = () => {
    const htmlToSave = editorRef.current ? editorRef.current.innerHTML : content;
    const blob = new Blob([htmlToSave], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flexee-manual.html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
const handleDownloadFullDocument = () => {
  const html = editorRef.current ? editorRef.current.innerHTML : content;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "flexee-full-document.html";
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
  type Chapter = { title: string; html: string };
  type WorkingChapter = {
  title: string;
  nodes: ChildNode[];
};


  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showChapterPanel, setShowChapterPanel] = useState(false);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);

  const handleSplitChapters = () => {
  const htmlSource = editorRef.current ? editorRef.current.innerHTML : content;

  if (!htmlSource || !htmlSource.trim()) {
    alert("No content found to split.");
    return;
  }

  const parser = new DOMParser();
  const docHtml = parser.parseFromString(htmlSource, "text/html");
  const bodyChildren: ChildNode[] = Array.from(docHtml.body.childNodes);

  const newChapters: Chapter[] = [];
 let current: any = null;

  bodyChildren.forEach((node: ChildNode) => {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).tagName === "H1"
    ) {
      // Flush previous chapter
      if (current && current.nodes.length > 0) {
        const wrapper = docHtml.createElement("div");
        current.nodes.forEach((n: ChildNode) => wrapper.appendChild(n.cloneNode(true)));
        newChapters.push({
          title: current.title,
          html: wrapper.innerHTML,
        });
      }

      const headingEl = node as HTMLElement;
      current = {
        title: headingEl.textContent?.trim() || "Untitled Chapter",
        nodes: [node],
      };
    } else if (current) {
      current.nodes.push(node);
    }
  });

  // Flush last chapter
  if (current && current.nodes.length > 0) {
    const wrapper = docHtml.createElement("div");
    current.nodes.forEach((n: ChildNode) => wrapper.appendChild(n.cloneNode(true)));
    newChapters.push({
      title: current.title,
      html: wrapper.innerHTML,
    });
  }

  if (newChapters.length === 0) {
    alert(
      "No <h1> headings found. Please ensure each chapter starts with an H1 heading."
    );
    return;
  }

  setChapters(newChapters);
  setSelectedChapterIndex(0);
  setShowChapterPanel(true);
};


  const handleDownloadCurrentChapter = () => {
    if (!showChapterPanel || chapters.length === 0) return;
    const chapter = chapters[selectedChapterIndex];
    const safeTitle = (chapter.title || "chapter")
      .replace(/[^a-z0-9]+/gi, "_")
      .toLowerCase();

    const blob = new Blob([chapter.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle || "chapter"}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  // -----------------------------------------------------
// Highlight original grammar errors in red
// -----------------------------------------------------
const highlightOriginalErrors = () => {
  // 🔒 1. Don't run while admin is typing
  if (typingRef.current) return;

  // 🔒 2. If editor isn't mounted, just skip
  if (!editorRef.current) return;

  // 3. Save cursor position BEFORE modifying HTML
  const caret = saveCursorPosition(editorRef.current);
  let html = editorRef.current.innerHTML;

  // 4. Wrap each "original" text with red highlight span
  corrections.forEach(({ original }) => {
    if (!original) return;

    const safeOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safeOriginal, "g");

    html = html.replace(
      regex,
      `<span class="grammar-error" style="background-color:#ffcccc;color:red;">${original}</span>`
    );
  });

  // If editor disappeared in between, bail out
  if (!editorRef.current) return;

  // 5. Replace HTML
  editorRef.current.innerHTML = html;

  // 6. Restore cursor in the next animation frame
  safeRestoreCursor(editorRef.current, caret);
};

const applyCorrections = () => {
  // 1. Don't run while typing
  if (typingRef.current) return;

  // 2. Editor must exist
  if (!editorRef.current) return;

  // 3. Save cursor before modifying HTML
  const caret = saveCursorPosition(editorRef.current);

  let html = editorRef.current.innerHTML;

  selectedCorrections.forEach((idx) => {
    const { original, corrected } = corrections[idx];
    if (!original || !corrected) return;

    // Escape special characters for regex
    const safeOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match grammar error span containing the original text
    const regex = new RegExp(
      `<span[^>]*class=["']grammar-error["'][^>]*>${safeOriginal}</span>`,
      "g"
    );

    html = html.replace(
      regex,
      `<span class="grammar-fixed" style="background-color:#ccffcc;color:green;">${corrected}</span>`
    );
  });
editorRef.current.innerHTML = html;
  safeRestoreCursor(editorRef.current, caret);
  debouncedUpdate(html, activePageId);

  alert("Selected grammar corrections applied!");
};


useEffect(() => {
  if (!editorRef.current) return;

  // run highlight ONLY once AFTER Run Audit is clicked
  if (auditType === "grammar" && corrections.length > 0 && isAuditing === false) {
    setTimeout(() => {
      highlightOriginalErrors();
    }, 50);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [corrections]);

useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    if (!editorRef.current) return;

    const editorEl = editorRef.current;

    // 🔹 Click INSIDE editor → do nothing
    if (editorEl.contains(event.target as Node)) return;

    let html = editorEl.innerHTML;

    // Remove RED "grammar-error" spans
    html = html.replace(
      /<span[^>]*class=["']grammar-error["'][^>]*>(.*?)<\/span>/g,
      "$1"
    );

    // Remove GREEN "grammar-fixed" spans
    html = html.replace(
      /<span[^>]*class=["']grammar-fixed["'][^>]*>(.*?)<\/span>/g,
      "$1"
    );

    // Update only if something changed
    if (html !== editorEl.innerHTML) {
      const caret = saveCursorPosition(editorEl);
      editorEl.innerHTML = html;
      safeRestoreCursor(editorEl, caret);
    }
  };

  document.addEventListener("click", handleClickOutside);
  return () => document.removeEventListener("click", handleClickOutside);
}, []);



  // ---------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen font-sans relative" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Top Navigation Bar */}
      <header
        className="px-6 py-3 flex justify-between items-center shadow-lg z-20"
        style={{ background: "var(--header)", color: "var(--header-text)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-4">
          <div className="bg-indigo-500 p-2 rounded-lg">
            {role === 'admin' ? (
              <Edit3 size={24} className="text-white" />
            ) : (
              <BookOpen size={24} className="text-white" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Flexee {role === 'admin' ? 'CMS' : 'Docs'}
            </h1>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {saveStatus === 'Saved' ? (
                <CheckCircle size={12} className="text-green-500" />
              ) : saveStatus === 'Saving...' ? (
                <Save size={12} className="text-orange-500 animate-pulse" />
              ) : (
                <AlertTriangle size={12} className="text-red-400" />
              )}
              <span>
                {role === 'admin'
                  ? `Admin Mode • ${saveStatus}`
                  : 'Live Version • Read Only'}
              </span>
            </div>
          </div>
        </div>

        {/* Role Switcher (only when logged in) */}
        <div className="flex items-center">
          {user ? (
            <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
              <button
                onClick={() => setRole('admin')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  role === 'admin'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShieldCheck size={14} /> Admin (Write)
              </button>
              <button
                onClick={() => setRole('reader')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  role === 'reader'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserIcon size={14} /> User (Read)
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-300 bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
              Read-only mode • Login to edit
            </div>
          )}
        </div>

        {/* Right Actions + Auth UI */}
        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-3 items-center">
            {role === 'admin' && user && (
              <>
                <button
                  onClick={() => setShowAuditor(!showAuditor)}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded transition-colors border border-slate-600 ${
                    showAuditor
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <AlertTriangle size={14} /> AI Auditor
                </button>
                <div className="h-6 w-px bg-slate-700 mx-1"></div>
                <button
                  onClick={() => setShowSource(!showSource)}
                  className="text-slate-300 hover:text-white"
                >
                  <FileCode size={18} />
                </button>
              </>
            )}
            <button
              onClick={() => {
                const k = prompt('Enter Gemini API Key:', apiKey);
                if (k) {
                  setApiKey(k);
                  localStorage.setItem('flexee_api_key', k);
                }
              }}
              className="text-slate-300 hover:text-white"
            >
              <Settings size={18} />
            </button>
          </div>

          {/* Simple Auth Form */}
          <div className="flex flex-col items-end gap-1 text-xs">
            {user ? (
              <div className="flex items-center gap-2">
                <span className="text-slate-300 flex items-center gap-1">
                  <UserIcon size={12} /> {user.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="px-2 py-1 rounded bg-slate-700 text-xs hover:bg-slate-600"
                >
                  Logout
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-1">
                  <input
                    type="email"
                    placeholder="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="px-2 py-1 text-xs rounded bg-slate-800 border border-slate-600 text-slate-100 focus:outline-none"
                  />
                  <input
                    type="password"
                    placeholder="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="px-2 py-1 text-xs rounded bg-slate-800 border border-slate-600 text-slate-100 focus:outline-none"
                  />
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={handleLogin}
                    disabled={authLoading}
                    className="px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600"
                  >
                    Login
                  </button>
                  
                  <button
                    onClick={handleSignUp}
                    disabled={authLoading}
                    className="px-2 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 w-30"
                  >
                    Sign Up
                  </button>
                  <button
                    onClick={handleGoogleLogin}
                    disabled={authLoading}
                    className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white w-full ">
                    Continue with Google
                  </button>

                </div>
                {authError && (
                  <span className="text-[10px] text-red-300 max-w-[220px] text-right">
                    {authError}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </header>

{/* Main Workspace */}
<div className="flex-1 flex overflow-hidden relative">
  {/* === ADMIN: AUDITOR PANEL === */}
  {/* === ADMIN: AUDITOR PANEL === */}
{role === "admin" && user && showAuditor && (
  <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col z-10 shadow-xl">

    {/* HEADER */}
    <div className="p-4 bg-amber-50 border-b border-amber-100">
      <h3 className="font-bold text-amber-900 flex items-center gap-2">
        <ShieldCheck size={18} /> Quality Auditor
      </h3>
      <p className="text-xs text-amber-700 mt-1">
        Select an audit type to scan your manual.
      </p>
    </div>

    {/* AUDIT TYPE BUTTONS */}
    <div className="p-4 flex flex-col gap-2">
      <button
        onClick={() => setAuditType("consistency")}
        className={`p-3 text-left rounded-lg text-sm font-medium border ${
          auditType === "consistency"
            ? "bg-white border-indigo-500 ring-1 ring-indigo-500 text-indigo-700"
            : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"
        }`}
      >
        <div className="flex items-center gap-2">
          <RefreshCw size={16} /> Consistency Check
        </div>
        <span className="text-xs text-slate-400 font-normal mt-1 block">
          Finds contradictions between chapters.
        </span>
      </button>

      <button
        onClick={() => setAuditType("grammar")}
        className={`p-3 text-left rounded-lg text-sm font-medium border ${
          auditType === "grammar"
            ? "bg-white border-indigo-500 ring-1 ring-indigo-500 text-indigo-700"
            : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"
        }`}
      >
        <div className="flex items-center gap-2">
          <Edit3 size={16} /> Grammar & Tone
        </div>
        <span className="text-xs text-slate-400 font-normal mt-1 block">
          Checks syntax, spelling, and voice.
        </span>
      </button>

      <button
        onClick={() => setAuditType("code")}
        className={`p-3 text-left rounded-lg text-sm font-medium border ${
          auditType === "code"
            ? "bg-white border-indigo-500 ring-1 ring-indigo-500 text-indigo-700"
            : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"
        }`}
      >
        <div className="flex items-center gap-2">
          <FileCode size={16} /> Tech & Code Review
        </div>
        <span className="text-xs text-slate-400 font-normal mt-1 block">
          Validates code snippets and logic.
        </span>
      </button>

      <button
        onClick={runAudit}
        disabled={isAuditing}
        className="mt-4 bg-indigo-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:bg-slate-300 flex justify-center items-center gap-2"
      >
        {isAuditing ? "Auditing..." : "Run Audit"}
      </button>
    </div>

    {/* === AUDIT REPORT SECTION === */}
    <div className="flex-1 overflow-y-auto p-4 border-t border-slate-200 bg-white">

      <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">
        Audit Report
      </h4>

      {/* TOOLBAR: SELECT ALL + APPLY FIXES + DOWNLOAD (Grammar Only) */}
      {auditType === "grammar" && corrections.length > 0 && (
        <div className="flex items-center justify-between my-3">

          {/* Select All */}
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={selectedCorrections.size === corrections.length}
              onChange={toggleSelectAll}
            />
            Select All
          </label>

          {/* Apply Selected Fixes */}
          <button
            onClick={applyCorrections}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700"
          >
            Apply Fixes
          </button>

          {/* Download */}
          <button
            onClick={handleDownloadAuditReport}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700"
          >
            Download
          </button>
        </div>
      )}

      {/* No Results */}
      {auditResults.length === 0 && !isAuditing && (
        <p className="text-sm text-slate-400 italic">No issues found yet.</p>
      )}

      {/* ================== NON-GRAMMAR OUTPUT ================== */}
      {auditType !== "grammar" && (
        <div className="space-y-3">
          {auditResults.map((res, idx) => (
            <div
              key={idx}
              className="text-sm p-3 bg-red-50 border border-red-100 rounded-lg text-slate-700"
            >
              {res}
            </div>
          ))}
        </div>
      )}

      {/* ================== GRAMMAR MODE OUTPUT ================== */}
      {auditType === "grammar" && corrections.length > 0 && (
        <div className="space-y-3 mt-4">
          {corrections.map((pair, idx) => (
            <div
              key={idx}
              className="p-3 bg-white border border-slate-200 rounded-md shadow-sm"
            >
              {/* Checkbox */}
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={selectedCorrections.has(idx)}
                  onChange={() => toggleCorrection(idx)}
                />
                <span className="text-xs text-slate-600">Select this correction</span>
              </label>

              {/* ORIGINAL */}
              <div className="text-sm text-red-600">
                <strong>Original:</strong> {pair.original}
              </div>

              {/* CORRECTED */}
              <div className="text-sm text-green-700">
                <strong>Corrected:</strong> {pair.corrected}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  </div>
)}



        {/* === MAIN CONTENT AREA === */}
        <div className="flex-1 flex flex-col relative overflow-hidden bg-white">
          {/* Admin Toolbar (Only for Admin) */}
          {role === 'admin' && user && (
            <div className="border-b border-slate-200 p-2 flex flex-wrap gap-1 bg-slate-50 items-center">
              <button
                onClick={toggleTheme}
                className="px-3 py-1.5 mr-3 rounded-md border border-slate-300 text-xs font-semibold
                           bg-[var(--card)] text-[var(--text)] hover:bg-[var(--border)]"
              >
                {theme === "light" ? " Dark Mode" : " Light Mode"}
              </button>
              <div className="flex gap-1 pr-2 border-r border-slate-300 mr-2">
                <ToolbarButton
                  onClick={() => {
                    if (editorRef.current) editorRef.current.focus();
                    document.execCommand("formatBlock", false, "H1");
                    updateFormatState();
                  }}
                  active={formatState.h1}
                  icon={Heading1}
                  title="H1"
                />

                <ToolbarButton
                  onClick={() => {
                    if (editorRef.current) editorRef.current.focus();
                    document.execCommand("formatBlock", false, "H2");
                    updateFormatState();
                  }}
                  active={formatState.h2}
                  icon={Heading2}
                  title="H2"
                />

                <ToolbarButton
                  onClick={() => {
                    if (editorRef.current) editorRef.current.focus();
                    document.execCommand("formatBlock", false, "P");
                    updateFormatState();
                  }}
                  active={formatState.p}
                  icon={Type}
                  title="Paragraph"
                />
              </div>
              <div className="flex gap-1 pr-2 border-r border-slate-300 mr-2">
                <ToolbarButton
                  onClick={() => {
                    if (editorRef.current) {
                      editorRef.current.focus();
                    }
                    document.execCommand('bold');
                    updateFormatState();
                  }}
                  active={formatState.bold}
                  icon={Bold}
                  title="Bold"
                />

                <ToolbarButton
                  onClick={() => {
                    if (editorRef.current) {
                      editorRef.current.focus();
                    }
                    document.execCommand('italic');
                    updateFormatState();
                  }}
                  active={formatState.italic}
                  icon={Italic}
                  title="Italic"
                />
              </div>
              <div className="ml-auto text-xs text-slate-400 px-2 font-mono">
                ADMIN EDITOR VIEW
              </div>
            </div>
          )}

          {/* User Header (Only for Reader) */}
          {role === 'reader' && (
            <div className="bg-emerald-50 border-b border-emerald-100 p-4">
              <h2 className="text-emerald-800 font-bold text-lg">
                Documentation Viewer
              </h2>
              <p className="text-emerald-600 text-sm">
                You are viewing the latest published version.
              </p>
            </div>
          )}

          {/* The Content */}
          <div className="flex-1 overflow-y-auto p-8 lg:p-12 relative bg-slate-50/50">
            {/* Admin-only actions above editor */}
            {role === 'admin' && user && !showSource && (
              <>
                <div className="max-w-3xl mx-auto mb-3 flex flex-wrap gap-2 justify-end">
                  <button
                    onClick={handleSaveAsHTML}
                    className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                  >
                    Save as HTML
                  </button>
                  <button
                    onClick={handleSplitChapters}
                    className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900"
                  >
                    Split Document by Chapters (H1)
                  </button>
                </div>

                {showChapterPanel && chapters.length > 0 && (
                  <div className="max-w-5xl mx-auto mb-6 flex gap-4">
                    {/* Sidebar with chapter titles */}
                    <div className="w-64 bg-slate-900 text-slate-100 rounded-lg border border-slate-700 p-3 flex flex-col">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Chapters (H1)
                        </span>
                        <button
                          onClick={() => setShowChapterPanel(false)}
                          className="text-[10px] text-slate-400 hover:text-slate-100"
                        >
                          Close
                        </button>
                      </div>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {chapters.map((ch, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedChapterIndex(idx)}
                            className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${
                              idx === selectedChapterIndex
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                            }`}
                          >
                            {ch.title || `Chapter ${idx + 1}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Chapter preview + per-chapter download */}
                    <div className="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 max-h-64 overflow-y-auto">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold">
                          {chapters[selectedChapterIndex]?.title || 'Selected Chapter'}
                        </h3>
                        <button
                          onClick={handleDownloadCurrentChapter}
                          className="px-2 py-1 text-[11px] rounded-md bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1"
                        >
                          <Save size={12} /> Download this chapter
                        </button>
                      </div>
                      <div
                        className="text-sm editor-content"
                        dangerouslySetInnerHTML={{
                          __html: chapters[selectedChapterIndex]?.html || '',
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="flex max-w-5xl mx-auto gap-4">

  {/* LEFT PANEL — DOCUMENT TABS (ADMIN ONLY) */}
  {role === 'admin' && user && (
    <div className="w-56 bg-slate-900 text-slate-50 rounded-lg border border-slate-700 flex-shrink-0 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-300">
          Document Tabs
        </span>
        <button
          type="button"
          onClick={handleAddPage}
          className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-slate-700 hover:bg-slate-600 text-slate-100 text-lg leading-none"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {isPagesLoading && (
          <div className="px-3 py-2 text-[11px] text-slate-400">
            Loading pages...
          </div>
        )}

        {!isPagesLoading && pages.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-slate-400">
            No pages yet. Click + to add one.
          </div>
        )}
        {lastDeletedPage && undoVisible && (
  <div className="p-2 border-t border-slate-700">
    <button
      onClick={async () => {
        try {
          const restoredRef = await addDoc(collection(db, "manualPages"), {
            title: lastDeletedPage.title,
            content: lastDeletedPage.content,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          setActivePageId(restoredRef.id); // Return to restored page
          setLastDeletedPage(null); // Clear undo buffer
        } catch (error) {
          console.error("Error restoring page:", error);
        }
      }}
      className="text-xs bg-[#34c759] text-black px-3 py-1.5 rounded hover:bg-[#2fb34f] w-full font-semibold"
    >
      Undo Delete
    </button>
  </div>
)}
        {pages.map((page) => {
          const isActive = page.id === activePageId;
          const isRenaming = page.id === renamingPageId;

          return (
            <button
  key={page.id}
  type="button"
  onClick={() => {
    setActivePageId(page.id);
    setShowDeleteFor(page.id);   // <-- show delete only for clicked page
  }}
  onDoubleClick={() => startRenamePage(page)}
  className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-xs ${
    page.id === activePageId
      ? "bg-slate-100 text-slate-900"
      : "bg-transparent text-slate-200 hover:bg-slate-800"
  }`}
>
  {/* LEFT — Page Title OR rename box */}
  {renamingPageId === page.id ? (
    <input
      autoFocus
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onBlur={commitRenamePage}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitRenamePage();
        } else if (e.key === "Escape") {
          setRenamingPageId(null);
        }
      }}
      className="w-full bg-slate-800 text-xs text-slate-50 rounded px-1 py-0.5 outline-none border border-slate-600"
    />
  ) : (
    <span className="truncate">{page.title}</span>
  )}

  {/* RIGHT — DELETE BUTTON (only for selected page) */}
  {showDeleteFor === page.id && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();  
        handleDeletePage(page.id);
        setShowDeleteFor(null);
      }}
      className="text-red-500 hover:text-red-700 text-[10px] ml-3 font-bold uppercase"
    >
      Delete
    </button>
  )}
</button>
          );
        })}
      </div>
    </div>
  )}

  {/* RIGHT SIDE — EDITOR */}
  <div className="flex-1">

    {role === 'admin' && user && showSource ? (
      <textarea
        ref={sourceRef}
        className="w-full h-full bg-slate-900 text-green-400 font-mono p-6 rounded text-sm focus:outline-none"
        value={content}
        onChange={(e) => debouncedUpdate(e.target.value, activePageId)}
      />
    ) : (
      <>
        <div
          dir="ltr"
          ref={editorRef}
          contentEditable={role === 'admin' && !!user}
          onInput={role === 'admin' && user ? handleInput : undefined}
          onPaste={role === 'admin' && user ? handlePaste : undefined}
          onFocus={handleEditorFocus}
          onKeyDown={(e) => handleEnter(e)}
          className="editor-content shadow-sm p-12 outline-none max-w-3xl mx-auto min-h-[600px]"
          style={{
            background: "var(--card)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            direction: "ltr",
            unicodeBidi: "bidi-override",
            textAlign: "left",
            writingMode: "horizontal-tb",
          }}
          dangerouslySetInnerHTML={
            role === 'reader' ? { __html: content } : undefined
          }
        />

        {role === 'admin' && user && !showSource && (
          <style>
            {`[contenteditable]:empty:before {
              content: "Start writing...";
              color: #94a3b8;
            }`}
          </style>
        )}
      </>
    )}

  </div>
</div>
          </div>
        </div>

        <style>
          {`
  .editor-content h1 {
    font-size: 2.2rem !important;
    font-weight: 700 !important;
    margin-top: 1rem !important;
    margin-bottom: 0.5rem !important;
  }

  .editor-content h2 {
    font-size: 1.8rem !important;
    font-weight: 600 !important;
    margin-top: 0.8rem !important;
    margin-bottom: 0.4rem !important;
  }

  .editor-content p {
    font-size: 1rem !important;
    margin-bottom: 0.6rem !important;
  }
`}
        </style>

        {/* === USER: CHAT BOT (Reader Only) === */}
        {role === 'reader' && (
          <div
            className={`w-96 bg-white border-l border-slate-200 shadow-xl flex flex-col z-10 transition-transform duration-300 ${
              showChat ? 'translate-x-0' : 'translate-x-full absolute right-0 h-full'
            }`}
          >
            {!showChat && (
              <button
                onClick={() => setShowChat(true)}
                className="absolute -left-16 bottom-8 bg-indigo-600 text-white p-3 rounded-l-xl shadow-lg hover:bg-indigo-700 transition-colors"
              >
                <MessageSquare size={24} />
              </button>
            )}

            {showChat && (
              <>
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-indigo-50">
                  <div className="flex items-center gap-2 font-bold text-indigo-900">
                    <Bot size={20} className="text-indigo-600" /> Flexee Assistant
                  </div>
                  <button
                    onClick={() => setShowChat(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`text-sm p-3 rounded-lg max-w-[85%] ${
                        msg.role === 'user'
                          ? 'bg-indigo-100 text-indigo-900 ml-auto rounded-tr-none'
                          : 'bg-white border border-slate-200 text-slate-700 mr-auto rounded-tl-none shadow-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                  ))}
                  {isChatTyping && (
                    <div className="text-xs text-slate-400 ml-2 animate-pulse">
                      Assistant is thinking...
                    </div>
                  )}
                </div>
                <div className="p-3 border-t border-slate-200 bg-white">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUserChat()}
                      placeholder="Ask about the manual..."
                      className="flex-1 text-sm p-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={handleUserChat}
                      className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;  