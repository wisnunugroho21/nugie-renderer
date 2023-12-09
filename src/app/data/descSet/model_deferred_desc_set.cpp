#include "model_deferred_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ModelDeferredDescSet::ModelDeferredDescSet(NugieVulkan::Device* device, uint32_t pointLightNum, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], VkDescriptorBufferInfo modelsInfo[3],
		std::vector<VkDescriptorImageInfo> renderTextureInfo[1], VkDescriptorImageInfo objectRexturesInfo[1]) 
	{
		this->createDescriptor(device, pointLightNum, descriptorPool, uniformBufferInfo, 
			modelsInfo, renderTextureInfo, objectRexturesInfo);
  }

	ModelDeferredDescSet::~ModelDeferredDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void ModelDeferredDescSet::createDescriptor(NugieVulkan::Device* device, uint32_t pointLightNum, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], VkDescriptorBufferInfo modelsInfo[3],
		std::vector<VkDescriptorImageInfo> renderTextureInfo[1], VkDescriptorImageInfo objectRexturesInfo[1])
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(4, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(5, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.build();

		std::vector<VkDescriptorImageInfo> *newRenderTextureInfos = new std::vector<VkDescriptorImageInfo>();
		this->descriptorSets.clear();
		
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			newRenderTextureInfos->clear();
			VkDescriptorSet descSet;
			
			for (uint32_t j = 0; j < pointLightNum; j++) {
				uint32_t totalIndex = i * pointLightNum + j;
				newRenderTextureInfos->emplace_back(renderTextureInfo[0][totalIndex]);
			}

			NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.writeBuffer(1, modelsInfo[0])
				.writeBuffer(2, modelsInfo[1])
				.writeBuffer(3, modelsInfo[2])
				.writeImage(4, newRenderTextureInfos)
				.writeImage(5, objectRexturesInfo[0])
				.build(&descSet);

			this->descriptorSets.emplace_back(descSet);
		}
  }
}