import { useFormFactor } from "../contexts/FormFactorContext";

export function useIsMobile() {
  const { isMobile } = useFormFactor();
  return isMobile;
}
