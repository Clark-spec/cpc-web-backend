import bcrypt from "bcrypt";
import { UserRepository } from "@/repositories/user-repository";
import { TokenRepository } from "@/repositories/token-repository";
import { signAccessToken, signRefreshToken, TokenExpiry } from "@/lib/jwt";

export async function loginService(identifier: string, password: string) {
  const userRepository = new UserRepository();
  const tokenRepository = new TokenRepository();

  try {
    // Validate User Credentials by Email or Student ID
    const user = await userRepository.findByIdentifier(identifier);
    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return { code: 401, status: "error", message: "Incorrect ID or password. Please try again." };
    }

    // Generate Access & Refresh Tokens
    const accessToken = signAccessToken(user.id, user.role, TokenExpiry.ACCESS_TOKEN_EXPIRES);
    const refreshToken = signRefreshToken(user.id, user.role, TokenExpiry.REFRESH_TOKEN_EXPIRES);

    // Save Refresh Token to DB for tracking/rotation
    await tokenRepository.createRefreshToken({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    // Return success response with full user profile info
    return {
      code: 200,
      status: "success",
      message: "Successfully logged in",
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          studentNumber: user.studentNumber,
          course: user.course,
          yearLevel: user.yearLevel,
          department: user.department,
          avatarUrl: user.avatarUrl,
        },
      },
    };

  } catch (error) {
    console.error("LoginCredentialService Error", error);
    return { code: 500, status: "error", message: "Failed to login account" };
  }
}
