'use strict';

import * as _ from 'lodash';

const angular = require('angular');

import { OVERRIDE_REGISTRY } from 'core/overrideRegistry/override.registry';
import { PIPELINE_CONFIG_SERVICE } from 'core/pipeline/config/services/pipelineConfig.service';
import { EditPipelineJsonModalCtrl } from './actions/json/editPipelineJsonModal.controller';
import { PIPELINE_CONFIG_VALIDATOR } from './validation/pipelineConfig.validator';
import { PIPELINE_TEMPLATE_SERVICE } from './templates/pipelineTemplate.service';

module.exports = angular.module('spinnaker.core.pipeline.config.pipelineConfigurer', [
  OVERRIDE_REGISTRY,
  PIPELINE_CONFIG_SERVICE,
  PIPELINE_CONFIG_VALIDATOR,
  PIPELINE_TEMPLATE_SERVICE,
])
  .directive('pipelineConfigurer', function() {
    return {
      restrict: 'E',
      scope: {
        pipeline: '=',
        application: '=',
        plan: '<',
        isTemplatedPipeline: '<',
      },
      controller: 'PipelineConfigurerCtrl as pipelineConfigurerCtrl',
      templateUrl: require('./pipelineConfigurer.html'),
    };
  })
  .controller('PipelineConfigurerCtrl', function($scope, $uibModal, $timeout, $window, $q,
                                                 pipelineConfigValidator, pipelineTemplateService,
                                                 pipelineConfigService, viewStateCache, overrideRegistry, $location) {
    // For standard pipelines, a 'renderablePipeline' is just the pipeline config.
    // For templated pipelines, a 'renderablePipeline' is the pipeline template plan, and '$scope.pipeline' is the template config.
    $scope.renderablePipeline = $scope.plan || $scope.pipeline;
    // Watch for non-reference changes to renderablePipline and make them reference changes to make React happy
    $scope.$watch('renderablePipeline', (newValue, oldValue) => newValue !== oldValue && this.updatePipeline(), true);
    this.actionsTemplateUrl = overrideRegistry.getTemplate('pipelineConfigActions', require('./actions/pipelineConfigActions.html'));

    this.warningsPopover = require('./warnings.popover.html');

    pipelineConfigService.getHistory($scope.pipeline.id, $scope.pipeline.strategy, 2).then(history => {
      if (history && history.length > 1) {
        $scope.viewState.hasHistory = true;
        this.setViewState({ hasHistory: true, loadingHistory: false });
      }
    }).finally(() => this.setViewState({loadingHistory: false}));

    var configViewStateCache = viewStateCache.get('pipelineConfig');

    function buildCacheKey() {
      return pipelineConfigService.buildViewStateCacheKey($scope.application.name, $scope.pipeline.id);
    }

    $scope.viewState = configViewStateCache.get(buildCacheKey()) || {
      section: 'triggers',
      stageIndex: 0,
      loading: false,
    };

    $scope.viewState.loadingHistory = true;

    let setOriginal = (pipeline) => {
      $scope.viewState.original = angular.toJson(pipeline);
      $scope.viewState.originalRenderablePipeline = angular.toJson($scope.renderablePipeline);
      this.updatePipeline();
    };

    let getOriginal = () => angular.fromJson($scope.viewState.original);

    const getOriginalRenderablePipeline = () => angular.fromJson($scope.viewState.originalRenderablePipeline);

    // keep it separate from viewState, since viewState is cached...
    $scope.navMenuState = {
      showMenu: false,
    };

    this.hideNavigationMenu = () => {
      // give the navigate method a chance to fire before hiding the menu
      $timeout(() => {
        $scope.navMenuState.showMenu = false;
      }, 200 );
    };

    this.deletePipeline = () => {
      $uibModal.open({
        templateUrl: require('./actions/delete/deletePipelineModal.html'),
        controller: 'DeletePipelineModalCtrl',
        controllerAs: 'deletePipelineModalCtrl',
        resolve: {
          pipeline: () => $scope.pipeline,
          application: () => $scope.application,
        }
      });
    };

    this.addStage = (newStage = { isNew: true }) => {
      $scope.renderablePipeline.stages = $scope.renderablePipeline.stages || [];
      newStage.refId = Math.max(0, ...$scope.renderablePipeline.stages.map(s => Number(s.refId) || 0)) + 1 + '';
      newStage.requisiteStageRefIds = [];
      if ($scope.renderablePipeline.stages.length && $scope.viewState.section === 'stage') {
        newStage.requisiteStageRefIds.push($scope.renderablePipeline.stages[$scope.viewState.stageIndex].refId);
      }
      $scope.renderablePipeline.stages.push(newStage);
      this.navigateToStage($scope.renderablePipeline.stages.length - 1);
    };

    this.copyExistingStage = () => {
      $uibModal.open({
        templateUrl: require('./copyStage/copyStage.modal.html'),
        controller: 'CopyStageModalCtrl',
        controllerAs: 'copyStageModalCtrl',
        resolve: {
          application: () => $scope.application,
          forStrategyConfig: () => $scope.pipeline.strategy,
        }
      }).result.then(stageTemplate => ctrl.addStage(stageTemplate)).catch(() => {});
    };

    var ctrl = this;
    $scope.stageSortOptions = {
      axis: 'x',
      delay: 150,
      placeholder: 'btn btn-default drop-placeholder',
      'ui-floating': true,
      start: (e, ui) => {
        ui.placeholder.width(ui.helper.width()).height(ui.helper.height());
      },
      update: (e, ui) => {
        var itemScope = ui.item.scope(),
          currentPage = $scope.viewState.stageIndex,
          startingPagePosition = itemScope.$index,
          isCurrentPage = currentPage === startingPagePosition;

        $timeout(() => {
          itemScope = ui.item.scope(); // this is terrible but provides a hook for mocking in tests
          var newPagePosition = itemScope.$index;
          if (isCurrentPage) {
            ctrl.navigateToStage(newPagePosition);
          } else {
            var wasBefore = startingPagePosition < currentPage,
              isBefore = newPagePosition <= currentPage;
            if (wasBefore !== isBefore) {
              var newCurrentPage = isBefore ? currentPage + 1 : currentPage - 1;
              ctrl.navigateToStage(newCurrentPage);
            }
          }
        });
      }
    };

    this.renamePipeline = () => {
      $uibModal.open({
        templateUrl: require('./actions/rename/renamePipelineModal.html'),
        controller: 'RenamePipelineModalCtrl',
        controllerAs: 'renamePipelineModalCtrl',
        resolve: {
          pipeline: () => $scope.pipeline,
          application: () => $scope.application
        }
      }).result.then(() => {
          setOriginal($scope.pipeline);
          markDirty();
        }).catch(() => {});
    };

    this.editPipelineJson = () => {
      $uibModal.open({
        templateUrl: require('./actions/json/editPipelineJsonModal.html'),
        controller: EditPipelineJsonModalCtrl,
        controllerAs: '$ctrl',
        size: 'lg modal-fullscreen',
        resolve: {
          pipeline: () => $scope.renderablePipeline,
        }
      }).result.then(() => {
        $scope.$broadcast('pipeline-json-edited');
        this.updatePipeline();
      }).catch(() => {});
    };

    // Enabling a pipeline simply toggles the disabled flag - it does not save any pending changes
    this.enablePipeline = () => {
      $uibModal.open({
        templateUrl: require('./actions/enable/enablePipelineModal.html'),
        controller: 'EnablePipelineModalCtrl as ctrl',
        resolve: {
          pipeline: () => getOriginal()
        }
      }).result.then(() => disableToggled(false)).catch(() => {});
    };

    // Disabling a pipeline also just toggles the disabled flag - it does not save any pending changes
    this.disablePipeline = () => {
      $uibModal.open({
        templateUrl: require('./actions/disable/disablePipelineModal.html'),
        controller: 'DisablePipelineModalCtrl as ctrl',
        resolve: {
          pipeline: () => getOriginal()
        }
      }).result.then(() => disableToggled(true)).catch(() => {});
    };

    function disableToggled(isDisabled) {
      $scope.pipeline.disabled = isDisabled;
      let original = getOriginal();
      original.disabled = isDisabled;
      setOriginal(original);
    }

    // Locking a pipeline persists any pending changes
    this.lockPipeline = () => {
      $uibModal.open({
        templateUrl: require('./actions/lock/lockPipelineModal.html'),
        controller: 'LockPipelineModalCtrl as ctrl',
        resolve: {
          pipeline: () => $scope.pipeline
        }
      }).result.then(() => setOriginal($scope.pipeline)).catch(() => {});
    };

    this.unlockPipeline = () => {
      $uibModal.open({
        templateUrl: require('./actions/unlock/unlockPipelineModal.html'),
        controller: 'unlockPipelineModalCtrl as ctrl',
        resolve: {
          pipeline: () => $scope.pipeline
        }
      }).result.then(function () {
        delete $scope.pipeline.locked;
        setOriginal($scope.pipeline);
      }).catch(() => {});
    };

    this.showHistory = () => {
      $uibModal.open({
        templateUrl: require('./actions/history/showHistory.modal.html'),
        controller: 'ShowHistoryCtrl',
        controllerAs: 'ctrl',
        size: 'lg modal-fullscreen',
        resolve: {
          pipelineConfigId: () => $scope.pipeline.id,
          isStrategy: $scope.pipeline.strategy,
          currentConfig: () => $scope.viewState.isDirty ? JSON.parse(angular.toJson($scope.pipeline)) : null,
        }
      }).result.then(newConfig => {
        $scope.pipeline = newConfig;
        this.savePipeline();
      }).catch(() => {});
    };

    // Poor react setState
    this.setViewState = (newViewState) => {
      Object.assign($scope.viewState, newViewState);
      const viewState = _.clone($scope.viewState);
      $scope.$applyAsync(() => $scope.viewState = viewState);
    };

    // Poor react setState
    this.updatePipeline = () => {
      $scope.$applyAsync(() => {
        $scope.renderablePipeline = _.clone($scope.renderablePipeline);
        // need to ensure references are maintained
        if ($scope.plan) {
          $scope.plan = $scope.renderablePipeline;
        } else {
          $scope.pipeline = $scope.renderablePipeline;
        }
      });
    };

    this.navigateToStage = (index, event) => {
      if (index < 0 || !$scope.renderablePipeline.stages || $scope.renderablePipeline.stages.length <= index) {
        this.setViewState({ section: 'triggers' });
        return;
      }
      this.setViewState({ section: 'stage', stageIndex: index});
      if (event && event.target && event.target.focus) {
        event.target.focus();
      }
    };

    this.navigateTo = (stage) => {
      if (stage.section === 'stage') {
        ctrl.navigateToStage(stage.index);
      } else {
        this.setViewState({ section: stage.section });
      }
    };

    // When using callbacks in a component that can be both angular and react, have to force binding in the angular world
    this.graphNodeClicked = this.navigateTo.bind(this);

    this.isActive = (section) => {
      return $scope.viewState.section === section;
    };

    this.stageIsActive = (index) => {
      return $scope.viewState.section === 'stage' && $scope.viewState.stageIndex === index;
    };

    this.removeStage = (stage) => {
      var stageIndex = $scope.renderablePipeline.stages.indexOf(stage);
      $scope.renderablePipeline.stages.splice(stageIndex, 1);
      $scope.renderablePipeline.stages.forEach((test) => {
        if (stage.refId && test.requisiteStageRefIds) {
          test.requisiteStageRefIds = _.without(test.requisiteStageRefIds, stage.refId);
        }
      });
      if (stageIndex > 0) {
        this.setViewState({ stageIndex: $scope.viewState.stageIndex - 1 });
      }
      if (!$scope.renderablePipeline.stages.length) {
        this.navigateTo({section: 'triggers'});
      }
    };

    this.isValid = () => {
      return _.every($scope.pipeline.stages, 'name') && !ctrl.preventSave;
    };

    this.configureTemplate = () => {
      this.setViewState({ loading: true });
      $uibModal.open({
        size: 'lg',
        templateUrl: require('core/pipeline/config/templates/configurePipelineTemplateModal.html'),
        controller: 'ConfigurePipelineTemplateModalCtrl as ctrl',
        resolve: {
          application: () => $scope.application,
          pipelineTemplateConfig: () => _.cloneDeep($scope.pipeline),
          isNew: () => $scope.pipeline.isNew,
          pipelineId: () => $scope.pipeline.id,
        }
      }).result.then(({plan, config}) => {
        $scope.pipeline = config;
        delete $scope.pipeline.isNew;
        $scope.renderablePipeline = plan;
      })
      .catch(() => {})
      .finally(() => this.setViewState({ loading: false }));
    };

    this.savePipeline = () => {
      this.setViewState({ saving: true });
      pipelineConfigService.savePipeline($scope.pipeline)
        .then(() => $scope.application.pipelineConfigs.refresh())
        .then(
          () => {
            setOriginal($scope.pipeline);
            markDirty();
            this.setViewState({ saving: false });
          },
          (err) => this.setViewState({ saveError: true, saving: false, saveErrorMessage: ctrl.getErrorMessage(err.data.message)})
        );
    };

    this.getErrorMessage = (errorMsg) => {
      var msg = 'There was an error saving your pipeline';
      if (_.isString(errorMsg)) {
        msg += ': ' + errorMsg;
      }
      msg += '.';

      return msg;
    };

    this.revertPipelineChanges = () => {
      let original = getOriginal();
      Object.keys($scope.pipeline).forEach(key => {
        delete $scope.pipeline[key];
      });
      Object.assign($scope.pipeline, original);

      if ($scope.isTemplatedPipeline) {
        const originalRenderablePipeline = getOriginalRenderablePipeline();
        Object.assign($scope.renderablePipeline, originalRenderablePipeline);
        Object.keys($scope.renderablePipeline).forEach(key => {
          if (!originalRenderablePipeline.hasOwnProperty(key)) {
            delete $scope.renderablePipeline[key];
          }
        });
      }

      // if we were looking at a stage that no longer exists, move to the last stage
      if ($scope.viewState.section === 'stage') {
        var lastStage = $scope.renderablePipeline.stages.length - 1;
        if ($scope.viewState.stageIndex > lastStage) {
          this.setViewState({ stageIndex: lastStage });
        }
        if (!$scope.renderablePipeline.stages.length) {
          this.navigateTo({section: 'triggers'});
        }
      }
      $scope.$broadcast('pipeline-reverted');
    };

    var markDirty = () => {
      if (!$scope.viewState.original) {
        setOriginal($scope.pipeline);
      }
      this.setViewState({ isDirty: $scope.viewState.original !== angular.toJson($scope.pipeline)});
    };

    function cacheViewState() {
      const toCache = { section: $scope.viewState.section, stageIndex: $scope.viewState.stageIndex };
      configViewStateCache.put(buildCacheKey(), toCache);
    }

    $scope.$watch('pipeline', markDirty, true);
    $scope.$watch('viewState.original', markDirty);
    $scope.$watchGroup(['viewState.section', 'viewState.stageIndex'], cacheViewState);

    this.navigateTo({section: $scope.viewState.section, index: $scope.viewState.stageIndex});


    this.getUrl = () => {
      return $location.absUrl();
    };

    const warningMessage = 'You have unsaved changes.\nAre you sure you want to navigate away from this page?';

    var confirmPageLeave = $scope.$on('$stateChangeStart', (event) => {
      if ($scope.viewState.isDirty) {
        if (!$window.confirm(warningMessage)) {
          event.preventDefault();
        }
      }
    });

    const validationSubscription = pipelineConfigValidator.subscribe((validations) => {
      this.validations = validations;
      this.preventSave = validations.preventSave;
    });

    $window.onbeforeunload = () => {
      if ($scope.viewState.isDirty) {
        return warningMessage;
      }
    };

    $scope.$on('$destroy', () => {
      confirmPageLeave();
      validationSubscription.unsubscribe();
      $window.onbeforeunload = undefined;
    });

    if ($scope.isTemplatedPipeline && $scope.pipeline.isNew) {
      this.configureTemplate();
    }
  });
