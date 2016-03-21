Template.Layout.helpers({
  activeIf: function (route) {
    var currentRoute = Router.current().route.getName();
    if (currentRoute === route) {
      return 'active';
    } else {
      return '';
    }
  }
});
