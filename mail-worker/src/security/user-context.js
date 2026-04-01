import JwtUtils from '../utils/jwt-utils';
import constant from '../const/constant';

const userContext = {
	getUserId(c) {
		return c.get('user').userId;
	},

	getUser(c) {
		return c.get('user');
	},

	async getToken(c) {
		const jwt = c.req.header(constant.TOKEN_HEADER);
		const payload = await JwtUtils.verifyToken(c,jwt);
		return payload?.token;
	},

	isAdmin(c) {
		const user = c.get('user');
		return user.type === 0 || user.email === c.env.admin;
	},
};
export default userContext;
