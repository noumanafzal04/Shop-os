import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignInForm from "../../components/auth/SignInForm";
import { PRODUCT } from "../../common/brand";

export default function SignIn() {
  return (
    <>
      <PageMeta
        title="Sign in"
        description={`Sign in to ${PRODUCT.name}`}
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
