import React, { createContext, useContext, useState, useEffect } from "react";
import { ConfigProvider, theme } from "antd";
import enGB from "antd/es/locale/en_GB";
import frFR from "antd/es/locale/fr_FR";
import dayjs from "dayjs";
import "dayjs/locale/en-gb";
import "dayjs/locale/fr";
import type { Locale } from "../i18n/types";
import { useLocale } from "./LocaleContext";

type ThemeMode = "light" | "dark";

interface CustomTokens {
  // Logo and branding
  logoPathLight: string;
  logoPathDark: string;
  logoPathMobileLight: string;
  logoPathMobileDark: string;

  // Sidebar specific tokens
  siderBg: string;
  siderLogoHeight: number;
  siderLogoMaxWidth: number;
  siderCollapsedText: string;

  // Header specific tokens
  headerHeight: number;
  headerLogoHeight: number;
  headerLogoMaxWidth: number;
  headerBorderColor: string;

  // Button colors
  buttonTextColor: string;
}

interface ThemeContextType {
  themeMode: ThemeMode;
  toggleTheme: () => void;
  isDark: boolean;
  customTokens: CustomTokens;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useAppTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within a ThemeProvider");
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
  initialTheme?: ThemeMode;
}

const antdLocales: Record<Locale, typeof enGB> = {
  en: enGB,
  fr: frFR,
};

const dayjsLocales: Record<Locale, string> = {
  en: "en-gb",
  fr: "fr",
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  initialTheme = "dark",
}) => {
  const { locale } = useLocale();
  dayjs.locale(dayjsLocales[locale]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialTheme);
  const isDark = themeMode === "dark";

  // One-time sync: if localStorage has a different value (e.g. cookie wasn't set yet),
  // trust localStorage and update the cookie for next server render
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as ThemeMode;
    if (savedTheme && savedTheme !== themeMode) {
      setThemeMode(savedTheme);
      document.cookie = `theme=${savedTheme};path=/;max-age=31536000;SameSite=Lax`;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = () => {
    const newTheme = themeMode === "light" ? "dark" : "light";
    setThemeMode(newTheme);
    localStorage.setItem("theme", newTheme);
    document.cookie = `theme=${newTheme};path=/;max-age=31536000;SameSite=Lax`;
  };

  // Sync dark class on <html> so Tailwind dark: variants work
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Custom tokens for our application
  const base = import.meta.env.BASE_URL;
  const customTokens: CustomTokens = {
    // Logo and branding
    logoPathLight: `${base}banner/TNT_logo-horizontal-BLACK.png`,
    logoPathDark: `${base}banner/TNT_logo-horizontal-WHITE.png`,
    logoPathMobileLight: `${base}banner/TNT_logo-BLACK.png`,
    logoPathMobileDark: `${base}banner/TNT_logo-WHITE.png`,

    // Sidebar specific tokens
    siderBg: isDark ? "#001529" : "#f6f6f6",
    siderLogoHeight: 32,
    siderLogoMaxWidth: 140,
    siderCollapsedText: isDark ? "#ffffff" : "#001529",

    // Header specific tokens
    headerHeight: 100,
    headerLogoHeight: 80,
    headerLogoMaxWidth: 280,
    headerBorderColor: isDark ? "#303030" : "#f0f0f0",

    // Button colors
    buttonTextColor: isDark ? "#ffffff" : "#000000",
  };

  return (
    <ThemeContext.Provider
      value={{ themeMode, toggleTheme, isDark, customTokens }}
    >
      <ConfigProvider
        locale={antdLocales[locale]}
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: "#1890ff",
            borderRadius: 8,
            colorBgContainer: isDark ? "#141414" : "#ffffff",
            colorBgElevated: isDark ? "#1f1f1f" : "#ffffff",
            colorBgLayout: isDark ? "#000000" : "#f0f2f5",
          },
          components: {
            Layout: {
              siderBg: customTokens.siderBg,
              triggerBg: "#002140",
              headerBg: isDark ? "#141414" : "#ffffff",
            },
            Menu: {
              darkItemBg: "#001529",
              darkItemSelectedBg: "#1890ff",
              darkItemHoverBg: "#112545",
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
};
