Server required to handle delete as supabase's delete user client method can only be run using the service role key.
That would be irresponsible to expose on the client side application.

Due to time constraints the security of this server itself can't be guaranteed (pass in user jwt in frontend request and verify authenticity with server supabase client), it's also not an essential requirement of the dissertation project.

run server:

```
npm start
```
