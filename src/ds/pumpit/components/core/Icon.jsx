import React from 'react';
import {
  FilePenLine, CircleQuestionMark, Package, ShoppingCart, Truck, ShieldCheck, ShieldAlert,
  LayoutDashboard, CalendarDays, FolderOpen, Bell, ChartColumn, Landmark, Camera,
  Search, BookOpen, Factory, Building2, MapPin, LogOut, Menu, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, ChevronsUpDown, ArrowUp, ArrowDown, X, RotateCcw,
  Circle, TrendingUp, TrendingDown, Minus, OctagonAlert, TriangleAlert, Info, Check,
  Wrench, Download, Plus, Image, Clock, Moon, ClipboardList, Fuel, Droplet,
  Sun, Gauge, Wallet, Settings, Inbox,
  MessageCircle, Phone, Send, ArrowLeft, Printer, Users, Paperclip, LifeBuoy, Receipt, ExternalLink, Activity,
  Eye, EyeOff,
} from 'lucide-react';

// Registre explicite : n'importer que les icônes utilisées garde le bundle léger.
// Toute nouvelle icône doit être ajoutée ici (import nommé + entrée du registre).
const REGISTRY = {
  'file-pen-line': FilePenLine, 'circle-question-mark': CircleQuestionMark,
  package: Package, 'shopping-cart': ShoppingCart, truck: Truck, 'shield-check': ShieldCheck, 'shield-alert': ShieldAlert,
  'layout-dashboard': LayoutDashboard, 'calendar-days': CalendarDays, 'folder-open': FolderOpen,
  bell: Bell, 'chart-column': ChartColumn, landmark: Landmark, camera: Camera,
  search: Search, 'book-open': BookOpen, factory: Factory, 'building-2': Building2,
  'map-pin': MapPin, 'log-out': LogOut, menu: Menu, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  'chevrons-left': ChevronsLeft, 'chevrons-right': ChevronsRight, 'chevrons-up-down': ChevronsUpDown,
  'arrow-up': ArrowUp, 'arrow-down': ArrowDown, x: X, 'rotate-ccw': RotateCcw,
  circle: Circle, 'trending-up': TrendingUp, 'trending-down': TrendingDown, minus: Minus,
  'octagon-alert': OctagonAlert, 'triangle-alert': TriangleAlert, info: Info, check: Check,
  wrench: Wrench, download: Download, plus: Plus, image: Image, clock: Clock, moon: Moon,
  'clipboard-list': ClipboardList, fuel: Fuel, droplet: Droplet,
  sun: Sun, gauge: Gauge, wallet: Wallet, settings: Settings, inbox: Inbox,
  'message-circle': MessageCircle, phone: Phone, send: Send, 'arrow-left': ArrowLeft, printer: Printer, users: Users,
  paperclip: Paperclip, 'life-buoy': LifeBuoy, receipt: Receipt, 'external-link': ExternalLink, activity: Activity,
  eye: Eye, 'eye-off': EyeOff,
};

// Charte : bibliothèque Lucide, trait de 2 px, extrémités arrondies, une seule couleur par icône.
export function Icon({ name, size = 18, strokeWidth = 2, color = 'currentColor', style, ...rest }) {
  const LucideIcon = REGISTRY[name];
  if (!LucideIcon) return null;
  return <LucideIcon size={size} strokeWidth={strokeWidth} color={color}
    style={{ display: 'inline-flex', flex: '0 0 auto', ...style }} aria-hidden="true" {...rest} />;
}
