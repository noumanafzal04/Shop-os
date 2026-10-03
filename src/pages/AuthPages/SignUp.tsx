import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignUpForm from "../../components/auth/SignUpForm";
import { PRODUCT } from "../../common/brand";

export default function SignUp() {
  return (
    <>
      <PageMeta
        title="Create account"
        description={`Create your ${PRODUCT.name} account`}
      />
      <AuthLayout>
        <SignUpForm />
      </AuthLayout>
    </>
  );
}
