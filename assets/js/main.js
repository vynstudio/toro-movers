(function ($) {
	"use strict";


	/*------------------------------------
			Preloader
		--------------------------------------*/

	$(window).on('load', function () {
		$('#preloader').delay(350).fadeOut('slow');
		$('body').delay(350).css({ 'overflow': 'visible' });
	});


	/*------------------------------------
		Mobile Menu
	--------------------------------------*/

	$('#mobile-menu-active').metisMenu();

	$('#mobile-menu-active .has-dropdown > a').on('click', function (e) {
		e.preventDefault();
	});

	$(".hamburger-menu > a").on("click", function (e) {
		e.preventDefault();
		$(".slide-bar").toggleClass("show");
		$("body").addClass("on-side");
		$('.body-overlay').addClass('active');
		$(this).addClass('active');
	});

	$(".close-mobile-menu > a").on("click", function (e) {
		e.preventDefault();
		$(".slide-bar").removeClass("show");
		$("body").removeClass("on-side");
		$('.body-overlay').removeClass('active');
		$('.hamburger-menu > a').removeClass('active');
	});

	$('.body-overlay').on('click', function () {
		$(this).removeClass('active');
		$(".slide-bar").removeClass("show");
		$("body").removeClass("on-side");
		$('.hamburger-menu > a').removeClass('active');
	});


	//hide and show sticky menu

	var prevScrollpos = window.pageYOffset;
	window.onscroll = function () {
		var currentScrollPos = window.pageYOffset;
		if (prevScrollpos > currentScrollPos) {
			document.getElementById("hideshow-sticky-menu").style.top = "0";

		} else {
			document.getElementById("hideshow-sticky-menu").style.top = "-200px";
			$(window).on('scroll', function () {
				var scroll = $(window).scrollTop();
				if (scroll < 200) {
					$(".main-header-area").removeClass("sticky-menu");
				} else {
					$(".main-header-area").addClass("sticky-menu");
				}
			});
		}
		prevScrollpos = currentScrollPos;
	}





	// feedback-active
	$('.testimonial-active').owlCarousel({
		loop: true,
		margin: 30,
		items: 3,
		autoplay: true,
		autoplaySpeed: 2000,
		navText: ['<i class="fa fa-angle-left"></i>', '<i class="fa fa-angle-right"></i>'],
		nav: false,
		dots: true,
		responsive: {
			0: {
				items: 1,
				margin: 0,
			},
			768: {
				items: 2,
			},
			900: {
				items: 3,
			},
		}
	});
	
	
	// feedback-active
	$('.testimonial-active-two').owlCarousel({
		loop: true,
		margin: 30,
		items: 3,
		autoplay: true,
		autoplaySpeed: 2000,
		navText: ['<i class=""><img src="assets/img/icon/arrow-left.png" alt="" title=""></i>', '<i class=""><img src="assets/img/icon/arrow-right.png" alt="" title=""></i>'],
		nav: true,
		dots: true,
		responsive: {
			0: {
				items: 1,
				margin: 0,
			},
			768: {
				items: 2,
			},
			900: {
				items: 3,
			},
		}
	});


	// feedback-active
	$('.testimonial-active2').owlCarousel({
		loop: true,
		margin: 30,
		items: 1,
		autoplay: true,
		autoplaySpeed: 2000,
		navText: ['<i class="fa fa-angle-left"></i>', '<i class="fa fa-angle-right"></i>'],
		nav: false,
		dots: true,
		responsive: {
			0: {
				items: 1,
				margin: 0,
			},
			768: {
				items: 1,
			},
			900: {
				items: 1,
			},
		}
	});


	// feature-active
	$('.feature-active, .team-active, .case-active, .blog-active').owlCarousel({
		loop: true,
		margin: 30,
		items: 3,
		autoplay: true,
		autoplaySpeed: 2000,
		navText: ['<i class="fa fa-angle-left"></i>', '<i class="fa fa-angle-right"></i>'],
		nav: false,
		dots: false,
		responsive: {
			0: {
				items: 1,
				margin: 0,
			},
			768: {
				items: 2,
			},
			900: {
				items: 3,
			},
		}
	});
	
	
	
	
	// Hero Slider
	$('.hero-slider').owlCarousel({
		loop: true,
		margin: 0,
		items: 1,
		autoplay: true,
		autoplaySpeed: 2000,
		autoplayTimeout: 7000,
		navText: ['<i class="fa fa-angle-left"></i>', '<i class="fa fa-angle-right"></i>'],
		nav: false,
		dots: false,
		responsive: {
			0: {
				items: 1,
				margin: 0,
			},
			768: {
				items: 1,
			},
			900: {
				items: 1,
			},
		}
	});
	
	


	// case-active2
	$('.case-active2').owlCarousel({
		loop: true,
		margin: 30,
		items: 4,
		autoplay: true,
		autoplaySpeed: 2000,
		navText: ['<i class="fa fa-angle-left"></i>', '<i class="fa fa-angle-right"></i>'],
		nav: false,
		dots: false,
		responsive: {
			0: {
				items: 1,
				margin: 0,
			},
			768: {
				items: 2,
			},
			900: {
				items: 3,
			},
			1024: {
				items: 4,
			},
		}
	});




	/*---------- 06.Set Background Image ----------*/
	if ($('[data-bg-src]').length > 0) {
		$('[data-bg-src]').each(function () {
			var src = $(this).attr('data-bg-src');
			$(this).css({
				'background-image': 'url(' + src + ')'
			});
		});
	};



	// -------------------- Remove Placeholder When Focus Or Click
	$("input,textarea").each(function () {
		$(this).data('holder', $(this).attr('placeholder'));
		$(this).on('focusin', function () {
			$(this).attr('placeholder', '');
		});
		$(this).on('focusout', function () {
			$(this).attr('placeholder', $(this).data('holder'));
		});
	});


	//----------  Quantity Added 
	$('.quantity-plus').each(function () {
		$(this).on('click', function (e) {
			e.preventDefault();
			var $qty = $(this).siblings(".qty-input");
			var currentVal = parseInt($qty.val());
			if (!isNaN(currentVal)) {
				$qty.val(currentVal + 1);
			}
		})
	});

	$('.quantity-minus').each(function () {
		$(this).on('click', function (e) {
			e.preventDefault();
			var $qty = $(this).siblings(".qty-input");
			var currentVal = parseInt($qty.val());
			if (!isNaN(currentVal) && currentVal > 1) {
				$qty.val(currentVal - 1);
			}
		});
	})


	/* magnificPopup img view */
	$('.popup-image').magnificPopup({
		type: 'image',
		gallery: {
			enabled: true
		}
	});

	/* magnificPopup video view */
	$('.popup-video').magnificPopup({
		type: 'iframe'
	});

	// active-class
	$('.do-box, .s-services').on('mouseenter', function () {
		$(this).addClass('active').parent().siblings().find('.do-box, .s-services').removeClass('active');
	})

	// isotop
	$('.grid').imagesLoaded(function () {
		// init Isotope
		var $grid = $('.grid').isotope({
			itemSelector: '.grid-item',
			percentPosition: true,
			masonry: {
				// use outer width of grid-sizer for columnWidth
				columnWidth: 0,
				gutter: 0
			}
		});
		// filter items on button click
		$('.portfolio-menu').on('click', 'button', function () {
			var filterValue = $(this).attr('data-filter');
			$grid.isotope({ filter: filterValue });
		});
	});

	//for menu active class
	$('.portfolio-menu button').on('click', function (event) {
		$(this).siblings('.active').removeClass('active');
		$(this).addClass('active');
		event.preventDefault();
	});

	//counter
	$('.counter').counterUp({
		delay: 10,
		time: 3000
	});



	// ===== Scroll to Top ==== 
	$(window).scroll(function () {
		if ($(this).scrollTop() >= 100) {
			$('.scrollUp').fadeIn(200);
		} else {
			$('.scrollUp').fadeOut(200);
		}
	});
	$('.scrollUp').click(function () {
		$('body,html').animate({
			scrollTop: 0
		}, 1000);
	});

	// wow animation - start
	// --------------------------------------------------
	function wowAnimation() {
		new WOW({
			offset: 100,
			mobile: true
		}).init()
	}
	wowAnimation();





	//nice-select
	$(document).ready(function () {
		$('select').niceSelect();
	});


})(jQuery);