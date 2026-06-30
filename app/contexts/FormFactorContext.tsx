import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

declare global {
  interface Window {
    __INITIAL_VIEWPORT_WIDTH__?: number;
  }
}

export interface FormFactorState {
  width: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

function computeFormFactor(width: number): FormFactorState {
  return {
    width,
    isMobile: width < MOBILE_BREAKPOINT,
    isTablet: width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT,
    isDesktop: width >= TABLET_BREAKPOINT,
  };
}

function getInitialWidth(ssrIsMobile = false) {
  if (typeof window === "undefined") {
    return ssrIsMobile ? MOBILE_BREAKPOINT - 1 : TABLET_BREAKPOINT;
  }

  if (typeof window.__INITIAL_VIEWPORT_WIDTH__ === "number") {
    return window.__INITIAL_VIEWPORT_WIDTH__;
  }

  return window.innerWidth;
}

const defaultFormFactor = computeFormFactor(getInitialWidth(false));

const FormFactorContext = createContext<FormFactorState>(defaultFormFactor);

interface FormFactorProviderProps {
  children: React.ReactNode;
  ssrIsMobile?: boolean;
}

export function FormFactorProvider({
  children,
  ssrIsMobile = false,
}: FormFactorProviderProps) {
  const [width, setWidth] = useState(() => getInitialWidth(ssrIsMobile));

  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const value = useMemo(() => {
    return computeFormFactor(width);
  }, [width]);

  return (
    <FormFactorContext.Provider value={value}>
      {children}
    </FormFactorContext.Provider>
  );
}

export function useFormFactor() {
  return useContext(FormFactorContext);
}
